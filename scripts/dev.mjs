import { spawn } from "node:child_process";
import { watch } from "node:fs";

// 本地双进程开发：
//   astro dev          负责页面与热更新（127.0.0.1:4321）
//   wrangler pages dev 负责 /api/auth（127.0.0.1:8788，页面侧由 Vite 代理转发）
//
// wrangler 跑的是 dist/ 快照，不会自己重建，所以这里盯 src/、functions/、
// public/ 和 astro.config.mjs，改动即重建 dist，让 8788 跟上源码。
// 任一进程退出则带走另一个。

const node = process.execPath;

const run = (name, args, options = {}) => {
  const child = spawn(node, args, { stdio: "inherit", ...options });
  child.on("exit", (code) => {
    console.log(`[dev] ${name} 退出，代码 ${code}`);
    shutdown(code ?? 0);
  });
  return child;
};

// 长驻服务用 run()，退出即收摊。
// 构建这类一次性子进程用下面这个，退出不能连坐。
const runOnce = (args, options = {}) =>
  spawn(node, args, { stdio: "inherit", ...options });

const children = [];
let closing = false;
let building = false;
let rebuildQueued = false;
let debounce = null;

const shutdown = (code = 0) => {
  if (closing) return;
  closing = true;
  clearTimeout(debounce);
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 300);
};

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const rebuild = () => {
  if (building) {
    rebuildQueued = true;
    return;
  }
  building = true;
  const build = runOnce(["node_modules/astro/bin/astro.mjs", "build"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  build.stdout.on("data", (chunk) => {
    const text = String(chunk);
    for (const line of text.split("\n")) {
      // 只留结果行和出错行，避免整屏 42 页列表
      if (/Complete!|error|Error|page\(s\) built/.test(line)) {
        console.log(`[build] ${line.replace(/\x1b\[[0-9;]*m/g, "").trim()}`);
      }
    }
  });
  build.on("exit", (code) => {
    building = false;
    if (code !== 0) console.log(`[build] 失败，代码 ${code}`);
    if (rebuildQueued) {
      rebuildQueued = false;
      rebuild();
    }
  });
};

const queueRebuild = () => {
  clearTimeout(debounce);
  debounce = setTimeout(rebuild, 400);
};

// 初始构建，保证 dist/ 与源码一致后再起服务
console.log("[dev] 初始构建中…");
await new Promise((resolve) => {
  const initial = spawn(node, ["node_modules/astro/bin/astro.mjs", "build"], {
    stdio: "inherit",
  });
  initial.on("exit", (code) => {
    if (code !== 0) {
      console.log(`[dev] 初始构建失败，代码 ${code}`);
      process.exit(code ?? 1);
    }
    resolve();
  });
});

children.push(
  run("api", [
    "node_modules/wrangler/bin/wrangler.js",
    "pages",
    "dev",
    "dist",
    "--port",
    "8788",
    "--ip",
    "127.0.0.1",
  ]),
);
children.push(run("web", ["node_modules/astro/bin/astro.mjs", "dev"]));

// 源码变化 → 重建 dist，让 8788 的产物跟上
for (const dir of ["src", "functions", "public"]) {
  try {
    watch(dir, { recursive: true }, queueRebuild);
  } catch {
    // 某些平台不支持 recursive，退回根目录轮询
  }
}
watch(".", { recursive: false }, (event, file) => {
  if (file === "astro.config.mjs" || file === "wrangler.jsonc") queueRebuild();
});

console.log("[dev] 已启动：页面 http://127.0.0.1:4321/，API http://127.0.0.1:8788/");

import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";

// 站点是全静态的，functions/ 由 Cloudflare Pages 单独编译。
// 本地用 `pnpm dev:api` 起 wrangler，这里把 /api 代理过去，
// 让 `astro dev` 下的登录和会话跟线上一致。
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:8788";

// astro dev 只服务 public/，构建产物（pagefind/、sitemap*.xml）不在其中，
// 线上却有。这里补一个只读中间件，从 dist/ 直接吐出这些文件。
const BUILD_ONLY_PREFIXES = ["/pagefind/", "/sitemap-"];
const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".pf_fragment": "application/octet-stream",
  ".pf_index": "application/octet-stream",
  ".pf_meta": "application/octet-stream",
};

const serveDistAssets = () => ({
  name: "serve-dist-assets",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? "").split("?")[0];
      if (!BUILD_ONLY_PREFIXES.some((p) => url.startsWith(p))) return next();

      // 防目录穿越：归一化后必须仍在 dist 内
      const safePath = normalize(url).replace(/^(\.\.[/\\])+/, "");
      const filePath = join(process.cwd(), "dist", safePath);
      if (!filePath.startsWith(join(process.cwd(), "dist"))) return next();
      if (!existsSync(filePath) || !statSync(filePath).isFile()) return next();

      res.setHeader(
        "Content-Type",
        MIME[extname(filePath)] ?? "application/octet-stream",
      );
      createReadStream(filePath).pipe(res);
    });
  },
});

export default defineConfig({
  site: "https://xhz6.com",
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [mdx(), sitemap()],
  // 固定绑 IPv4。Astro 默认只监听 [::1]，而 Windows 上 127.0.0.1 是另一条栈，会连不上。
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
  vite: {
    plugins: [tailwindcss(), serveDistAssets()],
    server: {
      proxy: {
        "/api": {
          target: API_ORIGIN,
          changeOrigin: false,
        },
      },
    },
  },
});

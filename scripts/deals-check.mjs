// 额度雷达来源巡检。
//
// 只做两件能确定的事：
//   1. 来源页是否 404 / 410（确定已下线）
//   2. 来源页正文有没有变化（和上次快照比对）
//
// 不会自动改额度数字，也不会动 verifiedAt —— 那属于人工判断。
// 结果写进 src/data/deals-status.json，由 GitHub Actions 提交并触发 Pages 重建。
//
// 判定口径偏向保守：
//   403 / 429 / 5xx / 网络错误 一律不算失效 —— 反爬、地区限制、登录墙太常见，
//   这些地区性差异一旦标成「失效」，页面就会天天误报。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEALS } from "../src/data/deals.ts";

const STATUS_PATH = fileURLToPath(
  new URL("../src/data/deals-status.json", import.meta.url),
);
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const LIMIT = Number(process.env.LIMIT ?? 0);
const UA =
  "Mozilla/5.0 (compatible; yuqing-deals-check/1.0; +https://xhz6.com/deals/)";

// 控制台 / 登录后的应用页内容每次都不同，不参与正文比对
const DYNAMIC_PATH = /\/(dashboard|console|login|signin|app)(\/|$)/i;
const DYNAMIC_HOST = /^(dashboard|console|platform|build|app|studio|api)\./i;

const previous = existsSync(STATUS_PATH)
  ? JSON.parse(readFileSync(STATUS_PATH, "utf8"))
  : { entries: {} };
const prevEntries = previous.entries ?? {};

/** 去掉脚本、样式和标签，只留可读正文，避免随机哈希导致误报 */
const normalize = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const digest = (html) =>
  createHash("sha256").update(normalize(html)).digest("hex").slice(0, 16);

const trackable = (deal) => {
  try {
    const url = new URL(deal.source);
    return !DYNAMIC_HOST.test(url.hostname) && !DYNAMIC_PATH.test(url.pathname);
  } catch {
    return false;
  }
};

async function probe(deal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(deal.source, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8" },
    });

    // 只有明确的「页面不存在」才算失效
    if (response.status === 404 || response.status === 410) {
      return { status: "dead", http: response.status };
    }
    if (response.status === 403 || response.status === 429) {
      return { status: "blocked", http: response.status };
    }
    if (!response.ok) {
      return { status: "unreachable", http: response.status };
    }

    const body = await response.text();
    if (!trackable(deal)) {
      return { status: "ok", http: response.status };
    }
    return { status: "ok", http: response.status, hash: digest(body) };
  } catch (error) {
    const name = error?.name ?? "Error";
    return { status: "unreachable", error: name === "AbortError" ? "timeout" : name };
  } finally {
    clearTimeout(timer);
  }
}

/** 页面上次变化后，人是否已经重新核对过 */
const isStillPending = (deal, changedAt) => {
  if (!changedAt) return false;
  const verified = new Date(`${deal.verifiedAt}T23:59:59`).getTime();
  return verified < new Date(changedAt).getTime();
};

const deals = LIMIT > 0 ? DEALS.slice(0, LIMIT) : DEALS;
const entries = { ...prevEntries };
const summary = { ok: 0, changed: 0, dead: 0, blocked: 0, unreachable: 0 };
const queue = [...deals];
let cursor = 0;

const worker = async () => {
  while (cursor < queue.length) {
    const deal = queue[cursor++];
    const prev = prevEntries[deal.id] ?? {};
    const now = new Date().toISOString();
    const result = await probe(deal);

    if (result.status === "dead" || result.status === "blocked" || result.status === "unreachable") {
      entries[deal.id] = {
        status: result.status,
        http: result.http,
        error: result.error,
        checkedAt: now,
        // 保留上次的哈希，等恢复访问后仍能判断内容是否变过
        hash: prev.hash,
        changedAt: prev.changedAt,
      };
      summary[result.status] += 1;
      console.log(
        `${result.status.padEnd(11)} ${deal.id} ${result.http ?? result.error}`,
      );
      continue;
    }

    // 正文噪声很大（模型列表轮换、随机推荐位），
    // 只有连续两次看到同一份新内容才认定「真的变了」
    let hash = result.hash;
    let pendingHash;
    let changedAt = isStillPending(deal, prev.changedAt)
      ? prev.changedAt
      : undefined;

    if (result.hash && prev.hash && result.hash !== prev.hash) {
      if (prev.pendingHash === result.hash) {
        changedAt = prev.changedAt ?? now;
      } else {
        pendingHash = result.hash;
        hash = prev.hash;
      }
    }

    const pending = isStillPending(deal, changedAt);

    entries[deal.id] = {
      status: pending ? "changed" : "ok",
      http: result.http,
      checkedAt: now,
      hash,
      pendingHash,
      // 人重新核对过就清掉待处理标记
      changedAt: pending ? changedAt : undefined,
    };
    summary[pending ? "changed" : "ok"] += 1;
    console.log(
      `${(pending ? "changed" : "ok").padEnd(11)} ${deal.id} ${result.http}`,
    );
  }
};

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const output = {
  checkedAt: new Date().toISOString(),
  summary,
  entries: Object.fromEntries(
    Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
  ),
};

writeFileSync(STATUS_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `\n完成：ok ${summary.ok} / changed ${summary.changed} / dead ${summary.dead} / blocked ${summary.blocked} / unreachable ${summary.unreachable}`,
);

import type { PagesFunction } from "@cloudflare/workers-types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const safeText = (value: unknown, maximum: number) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

const CJK = /[\u4e00-\u9fff]/;
const UPSTREAM_TIMEOUT_MS = 180_000;

// 尽力而为的每 IP 限流：实例内存计数，重启即清零。
// 真正的兜底是 Colab 端 GPU 锁——一次只画一张，其余请求立即 429。
const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function isRateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key);
    }
  }
  return recent.length > RATE_LIMIT;
}

// Google 翻译免密钥接口；失败时原样返回，不阻断生图流程
async function translateToEnglish(text: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=" +
          encodeURIComponent(text),
        { signal: controller.signal },
      );
      if (!response.ok) return text;
      const payload = (await response.json()) as unknown;
      const rows = Array.isArray(payload) ? (payload[0] as unknown[]) : [];
      const translated = rows
        .map((row) => (Array.isArray(row) && typeof row[0] === "string" ? row[0] : ""))
        .join("");
      return translated || text;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return text;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const upstreamBase = env.IMAGE_COLAB_URL?.trim().replace(/\/+$/, "");
  if (!upstreamBase) {
    return json({ error: "生图上游还没配置（IMAGE_COLAB_URL）。" }, 503);
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (isRateLimited(ip)) {
    return json({ error: "请求太频繁，每分钟最多 6 次。" }, 429);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "生图参数格式无效。" }, 400);
  }
  const input =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const prompt = safeText(input.prompt, 800);
  const prompt2 = safeText(input.prompt_2, 800);
  const negativePrompt = safeText(input.negative_prompt, 500);
  const steps = Number(input.steps);
  const guidance = Number(input.guidance);
  const width = Number(input.width);
  const height = Number(input.height);
  const seed = Number(input.seed);
  if (!prompt) {
    return json({ error: "主体描述不能为空。" }, 400);
  }

  // 含中文的三段提示词自动翻成英文
  const [enPrompt, enPrompt2, enNegative] = await Promise.all(
    [prompt, prompt2, negativePrompt].map((text) =>
      CJK.test(text) ? translateToEnglish(text) : Promise.resolve(text),
    ),
  );

  const body: Record<string, unknown> = {
    prompt: enPrompt,
    prompt_2: enPrompt2 || undefined, // 缺省时 diffusers 会沿用 prompt
    negative_prompt: enNegative || undefined,
  };
  // SDXL 常用分辨率：64 的倍数，512～1536
  const isDimension = (value: number) =>
    Number.isInteger(value) && value >= 512 && value <= 1536 && value % 64 === 0;
  if (isDimension(width)) body.width = width;
  if (isDimension(height)) body.height = height;
  if (Number.isInteger(steps) && steps > 0 && steps <= 100) body.steps = steps;
  if (Number.isFinite(guidance) && guidance > 0 && guidance <= 20)
    body.guidance = guidance;
  if (Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 32 - 1)
    body.seed = seed;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamBase + "/generate", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.IMAGE_COLAB_KEY?.trim() ?? "",
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return json({ error: "GPU 服务没响应，可能已下线，稍后再试。" }, 502);
  } finally {
    clearTimeout(timeout);
  }

  // 透传 Colab 的状态码和响应体，前端按状态码区分提示
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

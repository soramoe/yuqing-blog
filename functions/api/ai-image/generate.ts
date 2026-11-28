import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  createAndRunImageJob,
  ImageServiceError,
} from "../../../src/lib/image-service";
import { getImageSettings } from "../../../src/lib/image-settings";
import { notifyColabDown } from "../../../src/lib/system-notify";
import { gtxTranslate, translateImagePrompt } from "../../../src/lib/translate";

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

const colabBase = (env: Env) =>
  env.IMAGE_COLAB_URL?.trim().replace(/\/+$/, "") ?? "";

// 探活 + 配置：页面据此显示「服务在线/冷却中/正忙」和本次生图的积分价格
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await getImageSettings(env.DB);
  const base = colabBase(env);
  let ok = false;
  if (base) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${base}/health`, {
        signal: controller.signal,
        headers: { "ngrok-skip-browser-warning": "1" },
      });
      ok = response.ok;
    } catch {
      ok = false;
    } finally {
      clearTimeout(timeout);
    }
  }
  // 顺带返回 provider 冷却状态：隧道活着但冷却没过时，页面能如实显示
  const provider = await env.DB.prepare(
    `SELECT consecutive_failures AS failures, cooldown_until AS cooldownUntil
     FROM image_provider WHERE id = 'colab-sdxl'`,
  ).first<{ failures: number; cooldownUntil: number | null }>();
  const now = Date.now();
  const cooldownUntil = provider?.cooldownUntil
    ? Number(provider.cooldownUntil)
    : 0;
  const cooldownSeconds =
    cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  return json({
    ok,
    configured: Boolean(base),
    enabled: settings.enabled,
    points: settings.studioPoints,
    failures: Number(provider?.failures ?? 0),
    cooldownSeconds,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
  waitUntil,
}) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录后再生图。", code: "auth" }, 401);
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

  const requestId = safeText(input.requestId, 80);
  const prompt = safeText(input.prompt, 800);
  const prompt2 = safeText(input.prompt_2, 800);
  const negativePrompt = safeText(input.negative_prompt, 500);
  const quality = input.quality === "hd" ? "hd" : "standard";
  const ratio = ["1:1", "4:5", "16:9"].includes(String(input.aspectRatio))
    ? (String(input.aspectRatio) as "1:1" | "4:5" | "16:9")
    : "1:1";

  if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) {
    return json({ error: "生图请求标识无效。" }, 400);
  }
  if (prompt.length < 6) {
    return json({ error: "主体描述至少 6 个字。" }, 400);
  }

  // 中文 → SDXL 风格英文提示词（Workers AI 智能改写优先，直译兜底）
  const [enPrompt, enPrompt2, enNegative] = await Promise.all([
    translateImagePrompt(env, prompt),
    prompt2 ? translateImagePrompt(env, prompt2) : Promise.resolve(""),
    negativePrompt ? gtxTranslate(negativePrompt) : Promise.resolve(""),
  ]);

  try {
    const result = await createAndRunImageJob(env, {
      userId: session.user.id,
      requestId,
      feature: "image_studio",
      prompt,
      englishPrompt: enPrompt,
      prompt2: enPrompt2,
      negativePrompt: enNegative,
      quality,
      aspectRatio: ratio,
      permission: "private",
    });
    return json(
      {
        jobId: result.id,
        url: `/api/image/asset/${result.id}`,
        pointsCost: result.pointsCost,
        balance: result.balance,
        width: result.width,
        height: result.height,
        translated: enPrompt,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ImageServiceError) {
      // 生成阶段 503 基本就是 Colab 掉线：给站长发站内信 + 邮件（30 分钟去重）
      if (error.status === 503 && waitUntil) {
        waitUntil(notifyColabDown(env));
      }
      return json(
        {
          error: error.message,
          balance: error.balance,
          code:
            error.status === 402
              ? "insufficient"
              : error.status === 503
                ? "unavailable"
                : undefined,
        },
        error.status,
      );
    }
    return json({ error: "生图失败，请稍后重试。" }, 500);
  }
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, POST" },
  });
};

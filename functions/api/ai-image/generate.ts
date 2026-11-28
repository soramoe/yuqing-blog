import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  createAndRunImageJob,
  ImageServiceError,
  isImageAspectRatio,
} from "../../../src/lib/image-service";
import {
  getImageSettings,
  isSupportedImageAdapter,
  listImageProviders,
} from "../../../src/lib/image-settings";
import {
  isProviderConfigured,
  providerSupportsInitImage,
} from "../../../src/lib/image-providers";

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

// 参考图走 JSON body 传 data URL：页面限制 8MB 原图，base64 后约 10.7MB 字符
const MAX_INIT_IMAGE_CHARS = 12_000_000;
const INIT_IMAGE_PATTERN = /^data:image\/(png|jpeg|webp);base64,/i;

const parseInitImage = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (
    raw.length < 64 ||
    raw.length > MAX_INIT_IMAGE_CHARS ||
    !INIT_IMAGE_PATTERN.test(raw)
  ) {
    return null;
  }
  return raw;
};

// 配置 + 模型列表：供生图页渲染模型下拉框（当前仅火山方舟 / 智谱 GLM）
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const settings = await getImageSettings(env.DB);
  const providers = await listImageProviders(env.DB);
  const now = Date.now();
  const models = providers
    .filter((p) => {
      if (!p.enabled || !isSupportedImageAdapter(p.adapter)) return false;
      const list = p.features.split(",").map((s) => s.trim());
      return list.includes("image_studio");
    })
    .map((p) => {
      let status = "ready";
      if (!isProviderConfigured(env, p)) {
        status = "unconfigured";
      } else if (p.cooldownUntil && p.cooldownUntil > now) {
        status = "cooldown";
      }
      return {
        id: p.id,
        name: p.name,
        model: p.model,
        adapter: p.adapter,
        status,
        supportsInitImage: providerSupportsInitImage(p.adapter),
      };
    });
  const cooldownSeconds = Math.max(
    0,
    ...models.map((m) => {
      const provider = providers.find((p) => p.id === m.id);
      const until = provider?.cooldownUntil ?? 0;
      return until > now ? Math.ceil((until - now) / 1000) : 0;
    }),
  );
  return json({
    ok: true,
    enabled: settings.enabled,
    points: settings.studioPoints,
    pointsHd: settings.studioHdPoints,
    cooldownSeconds,
    models,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
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
  const negativePrompt = safeText(input.negative_prompt, 500);
  const quality = input.quality === "hd" ? "hd" : "standard";
  // 与 image-service 共用同一份比例白名单（含 auto：不传宽高，走模型默认）
  const ratio = isImageAspectRatio(input.aspectRatio)
    ? input.aspectRatio
    : "1:1";
  const initImage = parseInitImage(input.init_image);

  if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) {
    return json({ error: "生图请求标识无效。" }, 400);
  }
  if (prompt.length < 6) {
    return json({ error: "主体描述至少 6 个字。" }, 400);
  }
  if (initImage === null) {
    return json(
      { error: "参考图格式无效（仅支持 8MB 以内的 PNG/JPG/WebP）。" },
      400,
    );
  }

  // 用户自选模型：校验其存在且对生图开放
  const model = safeText(input.model, 80);
  let chosenAdapter = "";
  if (model) {
    const providers = await listImageProviders(env.DB);
    const chosen = providers.find(
      (p) =>
        p.id === model &&
        p.enabled &&
        isSupportedImageAdapter(p.adapter) &&
        p.features.split(",").map((s) => s.trim()).includes("image_studio"),
    );
    if (!chosen) {
      return json(
        { error: "所选模型不存在或未开放。", code: "bad_model" },
        400,
      );
    }
    chosenAdapter = chosen.adapter;
  }

  // 参考图只发给支持 img2img 的适配器；其余模型按纯文生图处理并在结果里提示
  const initSupported = !chosenAdapter || providerSupportsInitImage(chosenAdapter);
  const effectiveInitImage = initSupported ? initImage : "";
  const initNote =
    initImage && !initSupported
      ? "参考图已忽略：当前模型不支持图生图。"
      : "";

  // 火山方舟 Seedream / 智谱 GLM 原生理解中文，提示词直接用原文，不走翻译
  try {
    const result = await createAndRunImageJob(env, {
      userId: session.user.id,
      requestId,
      feature: "image_studio",
      providerId: model || undefined,
      prompt,
      initImage: effectiveInitImage || undefined,
      negativePrompt,
      quality,
      aspectRatio: ratio,
      permission: "private",
    });
    // 未指定模型时由路由器选模型：若最终选到不支持图生图的适配器，同样给出提示
    const note = [
      initNote,
      effectiveInitImage &&
      result.adapter &&
      !providerSupportsInitImage(result.adapter)
        ? "参考图已忽略：当前模型不支持图生图。"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    return json(
      {
        jobId: result.id,
        url: `/api/image/asset/${result.id}`,
        pointsCost: result.pointsCost,
        balance: result.balance,
        width: result.width,
        height: result.height,
        providerId: result.providerId,
        providerName: result.providerName,
        note: note || undefined,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ImageServiceError) {
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

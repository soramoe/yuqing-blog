import type {
  ImageProviderAdapter,
  ImageProviderConfig,
  ImageQuality,
} from "./image-settings";
import { gtxTranslate, translateImagePrompt } from "./translate";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

interface WorkersAiBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: { returnRawResponse?: boolean },
  ): Promise<unknown>;
}

export interface ImageProviderEnv {
  AI?: WorkersAiBinding;
  IMAGE_QWEN_API_KEY?: string;
  IMAGE_QWEN_BASE_URL?: string;
  IMAGE_SILICONFLOW_API_KEY?: string;
  IMAGE_SILICONFLOW_BASE_URL?: string;
  IMAGE_COLAB_URL?: string;
  IMAGE_COLAB_KEY?: string;
  IMAGE_BIGMODEL_API_KEY?: string;
  STORY_AI_API_KEY?: string;
  STORY_AI_BASE_URL?: string;
  STORY_AI_MODEL?: string;
}

export interface ImageGenerationRequest {
  feature: string;
  /** 用户自选的模型（provider id）；指定时路由只调用该模型 */
  providerId?: string;
  prompt: string;
  /** 参考图（data URL）；仅支持 img2img 的适配器使用（colab-sdxl） */
  initImage?: string;
  englishPrompt?: string;
  /** SDXL 第二文本编码器提示词，仅 colab-sdxl 适配器使用 */
  prompt2?: string;
  /** 排队插队（VIP 通道），仅 colab-sdxl 适配器使用 */
  jump?: boolean;
  negativePrompt: string;
  /** 未指定尺寸（auto）时为 undefined，适配器按各自默认处理 */
  width?: number;
  height?: number;
  quality: ImageQuality;
}

export interface ImageBinaryResult {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
}

export class ImageProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not-configured"
      | "quota-exhausted"
      | "rate-limited"
      | "invalid-response"
      | "provider-unavailable"
      | "timeout",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ImageProviderError";
  }
}

export function isProviderConfigured(
  env: ImageProviderEnv,
  provider: ImageProviderConfig,
) {
  if (provider.adapter === "workers-ai") return Boolean(env.AI);
  if (provider.adapter === "dashscope-images") {
    return Boolean(
      provider.apiKey?.trim() || env.IMAGE_QWEN_API_KEY?.trim(),
    );
  }
  if (provider.adapter === "colab-sdxl") {
    return Boolean(env.IMAGE_COLAB_URL?.trim());
  }
  if (provider.adapter === "ark-images") {
    return Boolean(provider.apiKey?.trim());
  }
  if (provider.adapter === "openai-images") {
    return Boolean(
      provider.apiKey?.trim() || env.IMAGE_SILICONFLOW_API_KEY?.trim(),
    );
  }
  if (provider.adapter === "bigmodel-image") {
    return Boolean(
      provider.apiKey?.trim() || env.IMAGE_BIGMODEL_API_KEY?.trim(),
    );
  }
  return false;
}

const arrayBufferBytes = (value: ArrayBuffer | ArrayBufferView) => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(
    value.buffer,
    value.byteOffset,
    value.byteLength,
  );
};

const base64Bytes = (value: string) => {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
};

// 火山 Seedream 尺寸约束：总像素需在 [921600(1280x720), 8294400(2880x2880)] 区间内，超限按面积等比缩放
const seedreamSize = (width?: number, height?: number) => {
  const MIN = 921_600;
  const MAX = 8_294_400;
  const w = Math.max(1, Math.round(width ?? 1024));
  const h = Math.max(1, Math.round(height ?? 1024));
  const area = w * h;
  const scale =
    area < MIN ? Math.sqrt(MIN / area) : area > MAX ? Math.sqrt(MAX / area) : 1;
  return `${Math.round(w * scale)}x${Math.round(h * scale)}`;
};

// 智谱 GLM-Image 尺寸约束：512–2048 且为 32 的整数倍
const glmSize = (width?: number, height?: number) => {
  const fix = (v?: number) =>
    Math.min(2048, Math.max(512, Math.round((v ?? 1024) / 32) * 32));
  return `${fix(width)}x${fix(height)}`;
};

const stripDataUrl = (value: string) =>
  value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;

// 生成完整接口地址：后台填的可能是基础地址，也可能是带 /images/generations 的完整地址
const imagesEndpoint = (baseUrl: string | undefined, fallbackBase: string) => {
  const base = (baseUrl?.trim() || fallbackBase).replace(/\/+$/, "");
  return base.endsWith("/images/generations")
    ? base
    : `${base}/images/generations`;
};

// 支持参考图（img2img）的适配器；其余适配器会忽略参考图按纯文字生成
const IMG2IMG_ADAPTERS = new Set(["colab-sdxl", "ark-images"]);
const needsEnglishPromptAdapters = new Set(["colab-sdxl", "workers-ai"]);

export const providerSupportsInitImage = (adapter: string) =>
  IMG2IMG_ADAPTERS.has(adapter);

// 只有 SDXL / Flux 这类英文模型需要先把中文改写成英文；原生中文模型直接用原文
export const providerNeedsEnglishPrompt = (adapter: string) =>
  needsEnglishPromptAdapters.has(adapter);

const detectContentType = (bytes: Uint8Array, fallback = "") => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return fallback.startsWith("image/") ? fallback : "image/png";
};

const normalizeBinary = async (
  value: unknown,
  width?: number,
  height?: number,
): Promise<ImageBinaryResult> => {
  let bytes: Uint8Array;
  let contentType = "";

  if (value instanceof Response) {
    if (!value.ok) {
      throw new ImageProviderError(
        `图片服务返回 HTTP ${value.status}。`,
        value.status === 429 ? "rate-limited" : "provider-unavailable",
        value.status === 429 || value.status >= 500,
      );
    }
    contentType = value.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await value.json()) as unknown;
      return normalizeBinary(payload, width, height);
    }
    bytes = new Uint8Array(await value.arrayBuffer());
  } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    bytes = arrayBufferBytes(value);
  } else if (value instanceof ReadableStream) {
    bytes = new Uint8Array(await new Response(value).arrayBuffer());
  } else if (value && typeof value === "object") {
    const output = value as Record<string, unknown>;
    const candidate =
      output.image ??
      output.imageBase64 ??
      output.b64_json ??
      (Array.isArray(output.images) ? output.images[0] : undefined);
    if (typeof candidate === "string") {
      bytes = base64Bytes(candidate);
    } else if (candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate)) {
      bytes = arrayBufferBytes(candidate);
    } else {
      throw new ImageProviderError(
        "图片服务没有返回可识别的图片数据。",
        "invalid-response",
        true,
      );
    }
  } else {
    throw new ImageProviderError(
      "图片服务返回格式无效。",
      "invalid-response",
      true,
    );
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageProviderError(
      "图片文件为空或超过 15 MB 限制。",
      "invalid-response",
      true,
    );
  }
  // auto 尺寸模式：调用方未传宽高时，从 PNG IHDR 头直接读出真实尺寸
  let finalWidth = width;
  let finalHeight = height;
  if ((!finalWidth || !finalHeight) && detectContentType(bytes) === "image/png") {
    if (bytes.length >= 24) {
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      finalWidth = view.getUint32(16);
      finalHeight = view.getUint32(20);
    }
  }
  return {
    bytes,
    contentType: detectContentType(bytes, contentType),
    width: finalWidth || width || 1024,
    height: finalHeight || height || 1024,
  };
};

async function generateWithWorkersAi(
  env: ImageProviderEnv,
  provider: ImageProviderConfig,
  request: ImageGenerationRequest,
) {
  if (!env.AI) {
    throw new ImageProviderError(
      "Cloudflare Workers AI 尚未绑定。",
      "not-configured",
      false,
    );
  }
  try {
    const isFluxSchnell = provider.model.includes("flux-1-schnell");
    const basePrompt =
      request.englishPrompt?.trim() || request.prompt;
    const negativePrompt = request.englishPrompt
      ? "text, subtitles, captions, watermark, logo, low resolution, deformed anatomy, extra limbs, real celebrities, trademarks"
      : request.negativePrompt;
    const prompt = negativePrompt
      ? `${basePrompt}\nAvoid: ${negativePrompt}`.slice(
          0,
          isFluxSchnell ? 2048 : 3000,
        )
      : basePrompt.slice(0, isFluxSchnell ? 2048 : 3000);
    const result = await env.AI.run(
      provider.model,
      isFluxSchnell
        ? {
            prompt,
            steps: request.quality === "hd" ? 8 : 4,
          }
        : {
            prompt,
            negative_prompt: request.negativePrompt || undefined,
            width: request.width,
            height: request.height,
            num_steps: request.quality === "hd" ? 20 : 12,
          },
      { returnRawResponse: true },
    );
    return await normalizeBinary(
      result,
      isFluxSchnell ? 1024 : request.width,
      isFluxSchnell ? 1024 : request.height,
    );
  } catch (error) {
    if (error instanceof ImageProviderError) throw error;
    const message = error instanceof Error ? error.message : "";
    const quota = /quota|limit|neurons|exceeded/i.test(message);
    throw new ImageProviderError(
      quota
        ? "Cloudflare Workers AI 免费额度已用完。"
        : "Cloudflare Workers AI 暂时无法生成图片。",
      quota ? "quota-exhausted" : "provider-unavailable",
      !quota,
    );
  }
}

async function fetchProviderImage(url: string) {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new ImageProviderError(
      `生成图片下载失败（HTTP ${response.status}）。`,
      response.status === 429 ? "rate-limited" : "provider-unavailable",
      response.status === 429 || response.status >= 500,
    );
  }
  const length = Number(response.headers.get("Content-Length") ?? 0);
  if (length > MAX_IMAGE_BYTES) {
    throw new ImageProviderError(
      "生成图片超过 15 MB 限制。",
      "invalid-response",
      false,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function generateWithDashScope(
  env: ImageProviderEnv,
  provider: ImageProviderConfig,
  request: ImageGenerationRequest,
) {
  // 密钥与接入地址：优先用后台绑定的供应商配置，留空回退环境变量
  const apiKey =
    provider.apiKey?.trim() || env.IMAGE_QWEN_API_KEY?.trim();
  if (!apiKey) {
    throw new ImageProviderError(
      "千问图片 API Key 尚未配置。",
      "not-configured",
      false,
    );
  }
  const baseUrl =
    provider.baseUrl?.trim() ||
    env.IMAGE_QWEN_BASE_URL?.trim() ||
    "https://dashscope.aliyuncs.com";
  const endpoint = baseUrl.endsWith("/multimodal-generation/generation")
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/api/v1/services/aigc/multimodal-generation/generation`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: request.prompt }],
            },
          ],
        },
        parameters: {
          negative_prompt: request.negativePrompt || undefined,
          n: 1,
          size: `${request.width ?? 1024}*${request.height ?? 1024}`,
          prompt_extend: false,
          watermark: false,
        },
      }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ImageProviderError(
        "图片服务响应超时。",
        "timeout",
        true,
      );
    }
    throw new ImageProviderError(
      "图片服务暂时无法连接。",
      "provider-unavailable",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new ImageProviderError(
        "图片服务请求过于频繁或额度不足。",
        "rate-limited",
        true,
      );
    }
    throw new ImageProviderError(
      `图片服务返回 HTTP ${response.status}。`,
      response.status === 402 ? "quota-exhausted" : "provider-unavailable",
      response.status >= 500,
    );
  }

  const payload = (await response.json()) as {
    code?: string;
    message?: string;
    output?: {
      choices?: Array<{
        message?: {
          content?: Array<{ image?: string }>;
        };
      }>;
      task_id?: string;
    };
  };
  if (payload.code || payload.message) {
    throw new ImageProviderError(
      payload.message || `图片服务错误 ${payload.code}`,
      payload.code === "Throttling" ? "rate-limited" : "provider-unavailable",
      false,
    );
  }
  if (payload.output?.task_id) {
    throw new ImageProviderError(
      "图片服务返回了异步任务，当前适配器尚未启用任务轮询。",
      "invalid-response",
      false,
    );
  }
  const url =
    payload.output?.choices?.[0]?.message?.content?.find(
      (item) => typeof item.image === "string" && item.image,
    )?.image;
  if (!url) {
    throw new ImageProviderError(
      "图片服务没有返回图片。",
      "invalid-response",
      true,
    );
  }
  const bytes = await fetchProviderImage(url);
  return normalizeBinary(bytes, request.width, request.height);
}

async function generateWithOpenAiImages(
  env: ImageProviderEnv,
  provider: ImageProviderConfig,
  request: ImageGenerationRequest,
) {
  // 密钥与接入地址：优先用后台绑定的供应商配置，留空回退环境变量
  const apiKey =
    provider.apiKey?.trim() || env.IMAGE_SILICONFLOW_API_KEY?.trim();
  if (!apiKey) {
    throw new ImageProviderError(
      "硅基流动 API Key 尚未配置。",
      "not-configured",
      false,
    );
  }
  const baseUrl =
    provider.baseUrl?.trim() ||
    env.IMAGE_SILICONFLOW_BASE_URL?.trim() ||
    "https://api.siliconflow.cn/v1";
  const endpoint = baseUrl.endsWith("/images/generations")
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, "")}/images/generations`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Enable-Watermark": "0",
      },
      body: JSON.stringify({
        model: provider.model,
        prompt: request.prompt,
        negative_prompt: request.negativePrompt || undefined,
        image_size: `${request.width ?? 1024}x${request.height ?? 1024}`,
        batch_size: 1,
        num_inference_steps: request.quality === "hd" ? 35 : 20,
      }),
    });
  } catch {
    throw new ImageProviderError(
      controller.signal.aborted
        ? "硅基流动图片服务响应超时。"
        : "硅基流动图片服务暂时无法连接。",
      controller.signal.aborted ? "timeout" : "provider-unavailable",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new ImageProviderError(
      response.status === 429
        ? "硅基流动图片请求过于频繁或额度不足。"
        : `硅基流动图片服务返回 HTTP ${response.status}。`,
      response.status === 429
        ? "rate-limited"
        : response.status === 402
          ? "quota-exhausted"
          : "provider-unavailable",
      response.status === 429 || response.status >= 500,
    );
  }
  const payload = (await response.json()) as {
    images?: Array<{ url?: string }>;
    data?: Array<{ url?: string; b64_json?: string }>;
    image?: string;
  };
  const image =
    payload.images?.find((item) => item.url)?.url ??
    payload.data?.find((item) => item.url)?.url;
  if (image) {
    const bytes = await fetchProviderImage(image);
    return normalizeBinary(bytes, request.width, request.height);
  }
  const base64 =
    payload.image ?? payload.data?.find((item) => item.b64_json)?.b64_json;
  if (base64) {
    return normalizeBinary(
      { b64_json: base64 },
      request.width,
      request.height,
    );
  }
  throw new ImageProviderError(
    "硅基流动没有返回图片。",
    "invalid-response",
    true,
  );
}

// 站长在 Colab 上自建的 SDXL 管线：英文提示词 + GPU 锁（并发时返回 429）
async function generateWithColab(
  env: ImageProviderEnv,
  provider: ImageProviderConfig,
  request: ImageGenerationRequest,
) {
  const baseUrl = env.IMAGE_COLAB_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ImageProviderError(
      `${provider.name} 的服务地址尚未配置。`,
      "not-configured",
      false,
    );
  }
  // Colab 管线只认英文；优先使用现成英文提示词，否则走智能改写链路
  // 用户没填负面提示词时，自动带一组 SDXL 标准负面，提升出图稳定性
  const DEFAULT_NEGATIVE =
    "lowres, blurry, bad anatomy, extra limbs, text, watermark, signature, jpeg artifacts";
  const prompt =
    request.englishPrompt?.trim() ||
    (await translateImagePrompt(env, request.prompt));
  const negativePrompt = request.negativePrompt
    ? await gtxTranslate(request.negativePrompt)
    : DEFAULT_NEGATIVE;

  const body = JSON.stringify({
    prompt,
    prompt_2: request.prompt2?.trim()
      ? await translateImagePrompt(env, request.prompt2)
      : undefined,
    negative_prompt: negativePrompt || undefined,
    width: request.width,
    height: request.height,
    steps: request.quality === "hd" ? 40 : 30,
    guidance: 6.0,
    // 参考图：v3 管线接受 data URL 或纯 base64，有参考图时走 img2img
    ...(request.initImage
      ? { init_image: request.initImage, strength: 0.55 }
      : {}),
  });

  // Cloudflare 边缘到 ngrok 偶发瞬断（GET 正常、POST 被瞬拒），自动重试 3 次；
  // 但排队等待可能长达数分钟，只有快速失败（<15 秒）才值得重试
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl}/generate`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.IMAGE_COLAB_KEY?.trim() ?? "",
          "ngrok-skip-browser-warning": "1",
          "x-queue-jump": request.jump ? "1" : "0",
        },
        body,
      });

      if (!response.ok) {
        throw new ImageProviderError(
          response.status === 429
            ? "排队已满或 GPU 忙，请稍等几秒再试。"
            : response.status === 401
              ? "Colab 上游密钥不匹配。"
              : `Colab 生图服务返回 HTTP ${response.status}。`,
          response.status === 429
            ? "rate-limited"
            : response.status === 401
              ? "not-configured"
              : "provider-unavailable",
          response.status === 429 || response.status >= 500,
        );
      }

      const payload = (await response.json().catch(() => null)) as {
        images?: string[];
      } | null;
      const base64 = payload?.images?.[0];
      if (!base64) {
        throw new ImageProviderError(
          "Colab 没有返回图片。",
          "invalid-response",
          true,
        );
      }
      return normalizeBinary(
        { b64_json: base64 },
        request.width,
        request.height,
      );
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      lastError = error;
      if (controller.signal.aborted) {
        throw new ImageProviderError(
          "Colab 生图响应超时，GPU 可能掉线了。",
          "timeout",
          true,
        );
      }
      // 只有快速失败（连接瞬断）才重试；排队等待后失败不重试，避免重复生成
      const elapsed = Date.now() - startedAt;
      if (elapsed > 15_000 || attempt >= 3) {
        const detail =
          lastError instanceof Error ? lastError.message : String(lastError);
        throw new ImageProviderError(
          `Colab GPU 服务连接失败（${detail.slice(0, 90)}），已自动重试 ${attempt} 次。`,
          "provider-unavailable",
          true,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError ?? "");
  throw new ImageProviderError(
    `Colab GPU 服务连接失败（${detail.slice(0, 90)}），已自动重试 3 次。`,
    "provider-unavailable",
    true,
  );
}

// 火山方舟（豆包 Seedream）：原生中文无需翻译；支持参考图（image）；无负面词/seed/guidance 参数
async function generateWithArk(
  env: ImageProviderEnv,
  provider: ImageProviderConfig,
  request: ImageGenerationRequest,
) {
  const apiKey = provider.apiKey?.trim();
  if (!apiKey) {
    throw new ImageProviderError(
      `${provider.name} 的 API 密钥尚未绑定（AI 配置页可绑定）。`,
      "not-configured",
      false,
    );
  }
  // 接入地址既可填基础地址，也可直接粘贴完整的 /images/generations 接口地址
  const endpoint = imagesEndpoint(
    provider.baseUrl,
    "https://ark.cn-beijing.volces.com/api/v3",
  );
  // auto 比例不传宽高：1K 用 1024²，2K 用 1536²，保证清晰度选择真实生效
  const fallbackSize = request.quality === "hd" ? 1536 : 1024;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        // Seedream 原生理解中文，直接用原文（比翻译成英文更贴合描述）
        prompt: request.prompt,
        // Seedream 5.x 支持参考图（Base64[]），按官方"单图生图/图像编辑"语义重绘
        ...(request.initImage
          ? { image: [stripDataUrl(request.initImage)] }
          : {}),
        response_format: "b64_json",
        size: seedreamSize(
          request.width ?? fallbackSize,
          request.height ?? fallbackSize,
        ),
        watermark: false,
      }),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let message = "";
      try {
        const parsed = JSON.parse(raw) as {
          error?: { code?: string; message?: string };
        };
        if (parsed?.error?.code === "SetLimitExceeded") {
          message =
            "火山方舟账户额度已达上限（安全体验模式限制），请到方舟控制台「模型激活」页调整或关闭该模式后重试。";
        } else if (parsed?.error?.message) {
          message = `火山方舟生图失败：${parsed.error.message.slice(0, 160)}`;
        }
      } catch {
        // 非 JSON 响应保持通用提示
      }
      if (!message) {
        message =
          response.status === 429
            ? "火山方舟请求过于频繁或额度不足。"
            : `火山方舟生图返回 HTTP ${response.status}（${raw.slice(0, 100)}）。`;
      }
      throw new ImageProviderError(
        message,
        response.status === 429 ? "rate-limited" : "provider-unavailable",
        response.status === 429 || response.status >= 500,
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    } | null;
    const item = payload?.data?.[0];
    if (item?.b64_json) {
      return normalizeBinary(
        { b64_json: item.b64_json },
        request.width,
        request.height,
      );
    }
    if (item?.url) {
      const bytes = await fetchProviderImage(item.url);
      return normalizeBinary(bytes, request.width, request.height);
    }
    throw new ImageProviderError(
      "火山方舟没有返回图片。",
      "invalid-response",
      true,
    );
  } catch (error) {
    if (error instanceof ImageProviderError) throw error;
    if (controller.signal.aborted) {
      throw new ImageProviderError("火山方舟生图响应超时。", "timeout", true);
    }
    throw new ImageProviderError(
      "火山方舟服务暂时无法连接。",
      "provider-unavailable",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

// 智谱 GLM-Image：原生中文；返回图片 URL 需二次下载；文档未提供负面词/参考图参数
async function generateWithBigModel(
  env: ImageProviderEnv,
  provider: ImageProviderConfig,
  request: ImageGenerationRequest,
) {
  const apiKey =
    provider.apiKey?.trim() || env.IMAGE_BIGMODEL_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new ImageProviderError(
      `${provider.name} 的 API 密钥尚未绑定（AI 配置页可绑定）。`,
      "not-configured",
      false,
    );
  }
  const endpoint = imagesEndpoint(
    provider.baseUrl,
    "https://open.bigmodel.cn/api/paas/v4",
  );
  // auto 比例不传宽高：1K 用 1024²，2K 用 1536²
  const fallbackSize = request.quality === "hd" ? 1536 : 1024;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        // GLM-Image 原生中文；官方文档 prompt 上限 1000 字符
        prompt: request.prompt.slice(0, 1000),
        size: glmSize(
          request.width ?? fallbackSize,
          request.height ?? fallbackSize,
        ),
      }),
    });
    if (!response.ok) {
      const detail = (
        await response.text().catch(() => "")
      ).slice(0, 100);
      throw new ImageProviderError(
        response.status === 429
          ? "智谱 GLM 请求过于频繁或额度不足。"
          : `智谱 GLM 生图返回 HTTP ${response.status}（${detail}）。`,
        response.status === 429 ? "rate-limited" : "provider-unavailable",
        response.status === 429 || response.status >= 500,
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    } | null;
    const item = payload?.data?.[0];
    if (item?.url) {
      const bytes = await fetchProviderImage(item.url);
      return normalizeBinary(bytes, request.width, request.height);
    }
    if (item?.b64_json) {
      return normalizeBinary(
        { b64_json: item.b64_json },
        request.width,
        request.height,
      );
    }
    throw new ImageProviderError(
      "智谱 GLM 没有返回图片。",
      "invalid-response",
      true,
    );
  } catch (error) {
    if (error instanceof ImageProviderError) throw error;
    if (controller.signal.aborted) {
      throw new ImageProviderError("智谱 GLM 生图响应超时。", "timeout", true);
    }
    throw new ImageProviderError(
      "智谱 GLM 服务暂时无法连接。",
      "provider-unavailable",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateWithProvider(
  env: ImageProviderEnv,
  provider: ImageProviderConfig,
  request: ImageGenerationRequest,
): Promise<ImageBinaryResult> {
  if (!isProviderConfigured(env, provider)) {
    throw new ImageProviderError(
      `${provider.name} 尚未配置。`,
      "not-configured",
      false,
    );
  }
  switch (provider.adapter as ImageProviderAdapter) {
    case "workers-ai":
      return generateWithWorkersAi(env, provider, request);
    case "dashscope-images":
      return generateWithDashScope(env, provider, request);
    case "openai-images":
      return generateWithOpenAiImages(env, provider, request);
    case "colab-sdxl":
      return generateWithColab(env, provider, request);
    case "ark-images":
      return generateWithArk(env, provider, request);
    case "bigmodel-image":
      return generateWithBigModel(env, provider, request);
    default:
      throw new ImageProviderError(
        "图片供应商适配器不受支持。",
        "not-configured",
        false,
      );
  }
}

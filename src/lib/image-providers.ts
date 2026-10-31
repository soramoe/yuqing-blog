import type {
  ImageProviderAdapter,
  ImageProviderConfig,
  ImageQuality,
} from "./image-settings";

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
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
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
  return Boolean(env.IMAGE_QWEN_API_KEY?.trim());
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
  width: number,
  height: number,
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
  return {
    bytes,
    contentType: detectContentType(bytes, contentType),
    width,
    height,
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
    const prompt = request.negativePrompt
      ? `${request.prompt}\n避免出现：${request.negativePrompt}`.slice(
          0,
          isFluxSchnell ? 2048 : 3000,
        )
      : request.prompt.slice(0, isFluxSchnell ? 2048 : 3000);
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
  const apiKey = env.IMAGE_QWEN_API_KEY?.trim();
  if (!apiKey) {
    throw new ImageProviderError(
      "千问图片 API Key 尚未配置。",
      "not-configured",
      false,
    );
  }
  const baseUrl =
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
          size: `${request.width}*${request.height}`,
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
    default:
      throw new ImageProviderError(
        "图片供应商适配器不受支持。",
        "not-configured",
        false,
      );
  }
}

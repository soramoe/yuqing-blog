import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const authorize = async (request: Request, env: Env) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return { error: json({ error: "请先登录。" }, 401) };
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return { error: json({ error: "你没有生图管理权限。" }, 403) };
  }
  return { userId: session.user.id };
};

interface ModelInfo {
  id: string;
  ownedBy?: string | null;
}

// 从 OpenAI 兼容接口拉取可选模型列表
async function pullModelList(
  endpoint: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`模型列表拉取失败（HTTP ${response.status}）`);
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: string; owned_by?: string }>;
      models?: Array<{ id?: string }>;
    };
    const rows = payload.data ?? payload.models ?? [];
    const models = rows
      .filter((m) => typeof m.id === "string" && m.id)
      .map((m) => ({ id: m.id as string, ownedBy: m.owned_by ?? null }));
    if (!models.length) throw new Error("接口没有返回任何模型");
    return models;
  } finally {
    clearTimeout(timeout);
  }
}

// 输入 API 请求地址 + 密钥，在线拉取该服务商的可选模型列表
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authorized = await authorize(request, env);
  if ("error" in authorized) return authorized.error;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const input =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const adapter = typeof input.adapter === "string" ? input.adapter : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const rawBaseUrl = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";

  if (!apiKey) {
    return json({ error: "请先填写 API 密钥。" }, 400);
  }

  try {
    let models: ModelInfo[] = [];
    if (adapter === "openai-images") {
      const base = (
        rawBaseUrl || "https://api.siliconflow.cn/v1"
      ).replace(/\/+$/, "");
      const endpoint = base.endsWith("/models")
        ? base
        : `${base}/models`;
      models = await pullModelList(endpoint, apiKey);
    } else if (adapter === "dashscope-images") {
      const base = (
        rawBaseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1"
      ).replace(/\/+$/, "");
      const endpoint = base.endsWith("/models")
        ? base
        : `${base}/models`;
      models = await pullModelList(endpoint, apiKey);
    } else {
      return json(
        { error: "该适配器不支持在线拉取模型列表，请手动填写模型名。" },
        400,
      );
    }
    return json({ models });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? `拉取失败：${error.message}`
            : "拉取失败，请检查地址与密钥。",
      },
      502,
    );
  }
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

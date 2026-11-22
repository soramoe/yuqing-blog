import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import {
  createAndRunImageJob,
  ImageServiceError,
} from "../../../../src/lib/image-service";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

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
  if (!session?.user) return json({ error: "请先登录。" }, 401);
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有生图测试权限。" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "测试参数格式无效。" }, 400);
  }
  const input =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const prompt =
    typeof input.prompt === "string" ? input.prompt.trim() : "";
  const requestId =
    typeof input.requestId === "string" ? input.requestId : "";
  if (prompt.length < 6) {
    return json({ error: "请输入至少 6 个字的测试提示词。" }, 400);
  }
  try {
    const result = await createAndRunImageJob(env, {
      userId: session.user.id,
      requestId,
      feature: "admin_test",
      prompt,
      negativePrompt:
        typeof input.negativePrompt === "string"
          ? input.negativePrompt
          : "",
      quality: input.quality === "hd" ? "hd" : "standard",
      aspectRatio:
        typeof input.aspectRatio === "string" ? input.aspectRatio : "1:1",
      permission: "private",
    });
    return json({ job: result }, 201);
  } catch (error) {
    if (error instanceof ImageServiceError) {
      return json(
        { error: error.message, balance: error.balance },
        error.status,
      );
    }
    return json({ error: "生图测试失败，请稍后重试。" }, 500);
  }
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

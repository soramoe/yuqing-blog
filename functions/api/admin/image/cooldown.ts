import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import { listImageProviders } from "../../../../src/lib/image-settings";
import { isProviderConfigured } from "../../../../src/lib/image-providers";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const authorize = async (request: Request, env: Env) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return { response: json({ error: "请求来源不受信任。" }, 403) };
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { response: json({ error: "请先登录。" }, 401) };
  }
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return { response: json({ error: "你没有生图管理权限。" }, 403) };
  }
  return { session };
};

// 一键清零所有图片供应商的连续失败计数与冷却锁。
// 用于：供应商已经恢复，但连续失败触发的冷却还没过期的情况。
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE image_provider
     SET consecutive_failures = 0, cooldown_until = NULL, updated_at = ?
     WHERE consecutive_failures > 0 OR cooldown_until IS NOT NULL`,
  )
    .bind(now)
    .run();

  const providers = await listImageProviders(env.DB);
  return json({
    ok: true,
    providers: providers.map((provider) => ({
      ...provider,
      configured: isProviderConfigured(env, provider),
      cooldownActive: Boolean(
        provider.cooldownUntil && provider.cooldownUntil > now,
      ),
    })),
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

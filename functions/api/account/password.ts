import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const passwordError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();
  if (normalized.includes("password too short")) {
    return "密码至少需要 10 个字符。";
  }
  if (normalized.includes("password already set")) {
    return "登录密码已经设置，请使用修改密码。";
  }
  if (
    normalized.includes("invalid password") ||
    normalized.includes("credential account not found")
  ) {
    return "当前密码不正确。";
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("session")
  ) {
    return "登录状态已失效，请重新登录后再操作。";
  }
  return fallback;
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (!["GET", "POST"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, POST" },
    });
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);

  if (request.method === "GET") {
    const credential = await env.DB.prepare(
      `SELECT CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END
         AS hasPassword
       FROM account
       WHERE user_id = ? AND provider_id = 'credential'
       LIMIT 1`,
    )
      .bind(session.user.id)
      .first<{ hasPassword: number }>();
    return json({
      hasPassword: Boolean(credential?.hasPassword),
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    });
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  if (!session.user.emailVerified) {
    return json({ error: "请先绑定并验证邮箱，再设置登录密码。" }, 403);
  }

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }

  const newPassword =
    typeof input.newPassword === "string" ? input.newPassword : "";
  if (newPassword.length < 10 || newPassword.length > 128) {
    return json({ error: "密码需要 10 到 128 个字符。" }, 400);
  }

  try {
    await auth.api.setPassword({
      body: { newPassword },
      headers: request.headers,
    });
  } catch (error) {
    return json(
      {
        error: passwordError(error, "登录密码设置失败。"),
      },
      400,
    );
  }

  return json({ ok: true, hasPassword: true });
};

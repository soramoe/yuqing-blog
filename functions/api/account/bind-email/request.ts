import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { sendOtpEmail } from "../../../../src/lib/email";
import {
  EMAIL_BINDING_EXPIRES_SECONDS,
  EMAIL_BINDING_HOURLY_LIMIT,
  EMAIL_BINDING_RESEND_SECONDS,
  generateEmailOtp,
  hashEmailOtp,
  isValidEmail,
  normalizeEmail,
} from "../../../../src/lib/email-binding";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  if (!env.BETTER_AUTH_SECRET) {
    return json({ error: "登录服务尚未配置完成。" }, 503);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const email = normalizeEmail((payload as { email?: unknown }).email);
  if (!isValidEmail(email)) {
    return json({ error: "请输入有效的邮箱地址。" }, 400);
  }

  const githubAccount = await env.DB.prepare(
    `SELECT id FROM account
     WHERE user_id = ? AND provider_id = 'github'
     LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ id: string }>();
  if (!githubAccount) {
    return json({ error: "请先使用 GitHub 登录后再绑定邮箱。" }, 403);
  }

  const duplicate = await env.DB.prepare(
    "SELECT id FROM user WHERE email = ? AND id != ? LIMIT 1",
  )
    .bind(email, session.user.id)
    .first<{ id: string }>();
  if (duplicate) {
    return json({ error: "该邮箱已经绑定到其他账号。" }, 409);
  }

  const now = Date.now();
  const latest = await env.DB.prepare(
    `SELECT created_at AS createdAt
     FROM email_binding_challenge
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ createdAt: number }>();
  if (
    latest &&
    Number(latest.createdAt) > now - EMAIL_BINDING_RESEND_SECONDS * 1000
  ) {
    return json(
      {
        error: "验证码发送太频繁，请稍后再试。",
        retryAfter: EMAIL_BINDING_RESEND_SECONDS,
      },
      429,
    );
  }

  const hourly = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM email_binding_challenge
     WHERE user_id = ? AND created_at >= ?`,
  )
    .bind(session.user.id, now - 60 * 60 * 1000)
    .first<{ total: number }>();
  if (Number(hourly?.total ?? 0) >= EMAIL_BINDING_HOURLY_LIMIT) {
    return json(
      { error: "一小时内发送次数过多，请稍后再试。" },
      429,
    );
  }

  const otp = generateEmailOtp();
  const id = crypto.randomUUID();
  const expiresAt = now + EMAIL_BINDING_EXPIRES_SECONDS * 1000;
  const codeHash = await hashEmailOtp(
    session.user.id,
    email,
    otp,
    env.BETTER_AUTH_SECRET,
  );

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE email_binding_challenge
       SET consumed_at = ?
       WHERE user_id = ? AND consumed_at IS NULL`,
    ).bind(now, session.user.id),
    env.DB.prepare(
      `INSERT INTO email_binding_challenge
        (id, user_id, email, code_hash, attempts, expires_at, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).bind(id, session.user.id, email, codeHash, expiresAt, now),
  ]);

  try {
    await sendOtpEmail(env, { email, otp, purpose: "bind-email" });
  } catch {
    await env.DB.prepare(
      "UPDATE email_binding_challenge SET consumed_at = ? WHERE id = ?",
    )
      .bind(Date.now(), id)
      .run();
    return json(
      { error: "邮件发送失败，请稍后重试或联系站长。" },
      503,
    );
  }

  return json({
    success: true,
    expiresIn: EMAIL_BINDING_EXPIRES_SECONDS,
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import {
  BINDING_REWARD,
  hasBindingReward,
} from "../../../../src/lib/binding-rewards";
import {
  equalHashes,
  hashEmailOtp,
  isValidEmail,
  normalizeEmail,
} from "../../../../src/lib/email-binding";

interface ChallengeRow {
  id: string;
  codeHash: string;
  attempts: number;
  expiresAt: number;
}

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
  const otp = String((payload as { otp?: unknown }).otp ?? "").trim();
  if (!isValidEmail(email)) {
    return json({ error: "邮箱地址无效。" }, 400);
  }
  if (!/^\d{6}$/.test(otp)) {
    return json({ error: "请输入 6 位数字验证码。" }, 400);
  }

  const githubAccount = await env.DB.prepare(
    `SELECT id FROM account
     WHERE user_id = ? AND provider_id = 'github' LIMIT 1`,
  )
    .bind(session.user.id)
    .first<{ id: string }>();
  if (!githubAccount) {
    return json({ error: "当前账号没有绑定 GitHub。" }, 403);
  }
  if (await hasBindingReward(env.DB, session.user.id, "email")) {
    return json({ error: "邮箱绑定奖励已经领取。" }, 409);
  }

  const challenge = await env.DB.prepare(
    `SELECT
      id,
      code_hash AS codeHash,
      attempts,
      expires_at AS expiresAt
     FROM email_binding_challenge
     WHERE user_id = ? AND email = ? AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(session.user.id, email)
    .first<ChallengeRow>();
  if (!challenge) {
    return json({ error: "验证码不存在或已经使用。" }, 400);
  }
  if (Number(challenge.expiresAt) < Date.now()) {
    return json({ error: "验证码已过期，请重新发送。" }, 410);
  }
  if (Number(challenge.attempts) >= 5) {
    return json({ error: "验证码尝试次数过多，请重新发送。" }, 429);
  }

  const expectedHash = await hashEmailOtp(
    session.user.id,
    email,
    otp,
    env.BETTER_AUTH_SECRET,
  );
  if (!equalHashes(expectedHash, challenge.codeHash)) {
    await env.DB.prepare(
      `UPDATE email_binding_challenge
       SET attempts = attempts + 1
       WHERE id = ?`,
    )
      .bind(challenge.id)
      .run();
    return json({ error: "验证码不正确。" }, 400);
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
  const transactionId = crypto.randomUUID();
  const referenceId = `binding:email:${session.user.id}`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE email_binding_challenge
         SET consumed_at = ?
         WHERE id = ? AND consumed_at IS NULL`,
      ).bind(now, challenge.id),
      env.DB.prepare(
        `UPDATE user
         SET email = ?, email_verified = 1, updated_at = ?
         WHERE id = ?`,
      ).bind(email, now, session.user.id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
         VALUES (?, 0, ?)`,
      ).bind(session.user.id, now),
      env.DB.prepare(
        `UPDATE point_account
         SET balance = balance + ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(BINDING_REWARD, now, session.user.id),
      env.DB.prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, operator_user_id, created_at)
         SELECT ?, ?, ?, 'binding_email', '绑定邮箱奖励', ?,
           CASE WHEN a.balance >= 0 THEN a.balance ELSE NULL END,
           NULL, ?
         FROM point_account a
         WHERE a.user_id = ?`,
      ).bind(
        transactionId,
        session.user.id,
        BINDING_REWARD,
        referenceId,
        now,
        session.user.id,
      ),
    ]);
  } catch {
    if (await hasBindingReward(env.DB, session.user.id, "email")) {
      return json({ error: "邮箱绑定奖励已经领取。" }, 409);
    }
    return json({ error: "邮箱绑定失败，请稍后重试。" }, 500);
  }

  return json({
    success: true,
    email,
    awarded: true,
    amount: BINDING_REWARD,
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录。" }, 401);
  }
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有积分管理权限。" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const input = payload as {
    userId?: unknown;
    amount?: unknown;
    reason?: unknown;
    requestId?: unknown;
  };
  const userId = typeof input.userId === "string" ? input.userId : "";
  const amount =
    typeof input.amount === "number" ? Math.trunc(input.amount) : NaN;
  const reason =
    typeof input.reason === "string" ? input.reason.trim() : "";
  const requestId =
    typeof input.requestId === "string" ? input.requestId.trim() : "";

  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(userId)) {
    return json({ error: "用户标识无效。" }, 400);
  }
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 100_000) {
    return json({ error: "积分调整必须是 ±1 到 ±100000 的整数。" }, 400);
  }
  if (reason.length < 2 || reason.length > 120) {
    return json({ error: "调整原因需要填写 2 到 120 个字符。" }, 400);
  }
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) {
    return json({ error: "操作请求标识无效。" }, 400);
  }

  const target = await env.DB.prepare(
    "SELECT id, name FROM user WHERE id = ?",
  )
    .bind(userId)
    .first<{ id: string; name: string }>();
  if (!target) {
    return json({ error: "目标用户不存在。" }, 404);
  }

  const currentAccount = await env.DB.prepare(
    "SELECT balance FROM point_account WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ balance: number }>();
  if (amount < 0 && Number(currentAccount?.balance ?? 0) + amount < 0) {
    return json({ error: "扣减失败：用户积分余额不足。" }, 409);
  }

  const referenceId = `admin:${session.user.id}:${requestId}`;
  const existing = await env.DB.prepare(
    `SELECT id, balance_after AS balanceAfter
     FROM point_transaction
     WHERE reference_id = ?`,
  )
    .bind(referenceId)
    .first<{ id: string; balanceAfter: number }>();
  if (existing) {
    return json({
      ok: true,
      duplicate: true,
      balance: Number(existing.balanceAfter),
    });
  }

  const now = Date.now();
  const transactionId = crypto.randomUUID();
  const type = amount > 0 ? "admin_credit" : "admin_debit";

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
         VALUES (?, 0, ?)`,
      ).bind(userId, now),
      env.DB.prepare(
        `UPDATE point_account
         SET balance = balance + ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(amount, now, userId),
      env.DB.prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, operator_user_id, created_at)
         SELECT ?, ?, ?, ?, ?, ?,
           CASE WHEN a.balance >= 0 THEN a.balance ELSE NULL END,
           ?, ?
         FROM point_account a
         WHERE a.user_id = ?`,
      ).bind(
        transactionId,
        userId,
        amount,
        type,
        reason,
        referenceId,
        session.user.id,
        now,
        userId,
      ),
    ]);
  } catch (error) {
    const duplicate = await env.DB.prepare(
      "SELECT balance_after AS balanceAfter FROM point_transaction WHERE reference_id = ?",
    )
      .bind(referenceId)
      .first<{ balanceAfter: number }>();
    if (duplicate) {
      return json({
        ok: true,
        duplicate: true,
        balance: Number(duplicate.balanceAfter),
      });
    }

    if (amount < 0) {
      return json({ error: "扣减失败：用户积分余额不足。" }, 409);
    }
    return json({ error: "积分调整失败，请稍后重试。" }, 500);
  }

  const balance = await env.DB.prepare(
    "SELECT balance FROM point_account WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ balance: number }>();
  return json({
    ok: true,
    balance: Number(balance?.balance ?? 0),
    targetName: target.name,
    amount,
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  hashRedemptionCode,
  normalizeRedemptionCode,
} from "../../../src/lib/shop";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

interface RedemptionCodeRow {
  id: string;
  amount: number;
  redeemedAt: number | null;
  expiresAt: number | null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录后再兑换积分码。" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }

  const input = payload as { code?: unknown };
  const submitted = typeof input.code === "string" ? input.code : "";
  const normalized = normalizeRedemptionCode(submitted);
  if (normalized.length < 12 || normalized.length > 32) {
    return json({ error: "兑换码格式无效。" }, 400);
  }

  const codeHash = await hashRedemptionCode(normalized);
  const code = await env.DB.prepare(
    `SELECT id, amount, redeemed_at AS redeemedAt, expires_at AS expiresAt
     FROM point_redemption_code
     WHERE code_hash = ?`,
  )
    .bind(codeHash)
    .first<RedemptionCodeRow>();

  if (!code) {
    return json({ error: "兑换码不存在或已失效。" }, 404);
  }
  if (code.redeemedAt !== null) {
    return json({ error: "这个兑换码已经被使用。" }, 409);
  }
  if (code.expiresAt !== null && Number(code.expiresAt) <= Date.now()) {
    return json({ error: "这个兑换码已经过期。" }, 410);
  }

  const userId = session.user.id;
  const now = Date.now();
  const transactionId = crypto.randomUUID();
  const amount = Number(code.amount);

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
         VALUES (?, 0, ?)`,
      ).bind(userId, now),
      env.DB.prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, created_at)
         SELECT ?, ?, c.amount, 'redeem_code', '积分兑换码',
           'code:' || c.id, COALESCE(a.balance, 0) + c.amount, ?
         FROM point_redemption_code c
         LEFT JOIN point_account a ON a.user_id = ?
         WHERE c.id = ? AND c.redeemed_at IS NULL`,
      ).bind(transactionId, userId, now, userId, code.id),
      env.DB.prepare(
        `UPDATE point_redemption_code
         SET redeemed_by_user_id = ?, redeemed_at = ?
         WHERE id = ? AND redeemed_at IS NULL`,
      ).bind(userId, now, code.id),
      env.DB.prepare(
        `UPDATE point_account
         SET balance = balance + ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(amount, now, userId),
    ]);
  } catch {
    return json({ error: "兑换码已经被使用，请刷新后重试。" }, 409);
  }

  const balance = await env.DB.prepare(
    "SELECT balance FROM point_account WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ balance: number }>();

  return json(
    {
      ok: true,
      amount,
      balance: Number(balance?.balance ?? 0),
      description: "积分兑换码",
    },
    201,
  );
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

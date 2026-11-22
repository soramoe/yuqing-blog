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

interface ShopItemRow {
  id: string;
  name: string;
  description: string;
  pricePoints: number;
  stock: number;
  perUserLimit: number;
  deliveryNote: string;
  active: number;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录后再兑换。" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }

  const input = payload as { itemId?: unknown; requestId?: unknown };
  const itemId = typeof input.itemId === "string" ? input.itemId.trim() : "";
  const requestId =
    typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(itemId)) {
    return json({ error: "商品标识无效。" }, 400);
  }
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(requestId)) {
    return json({ error: "兑换请求标识无效。" }, 400);
  }

  const userId = session.user.id;
  const item = await env.DB.prepare(
    `SELECT
       id, name, description,
       price_points AS pricePoints,
       stock,
       per_user_limit AS perUserLimit,
       delivery_note AS deliveryNote,
       active
     FROM shop_item
     WHERE id = ?`,
  )
    .bind(itemId)
    .first<ShopItemRow>();
  if (!item || !item.active) {
    return json({ error: "商品不存在或已下架。" }, 404);
  }
  if (Number(item.stock) < 1) {
    return json({ error: "商品暂时没有库存。" }, 409);
  }

  const [account, redeemed] = await Promise.all([
    env.DB.prepare(
      "SELECT balance FROM point_account WHERE user_id = ?",
    )
      .bind(userId)
      .first<{ balance: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count FROM shop_order
       WHERE user_id = ? AND item_id = ?
         AND status IN ('pending', 'fulfilled')`,
    )
      .bind(userId, itemId)
      .first<{ count: number }>(),
  ]);
  const price = Number(item.pricePoints);
  if (Number(account?.balance ?? 0) < price) {
    return json({ error: "积分余额不足。" }, 409);
  }
  if (Number(redeemed?.count ?? 0) >= Number(item.perUserLimit)) {
    return json({ error: "你已经兑换过这个商品。" }, 409);
  }

  const now = Date.now();
  const orderId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
         VALUES (?, 0, ?)`,
      ).bind(userId, now),
      env.DB.prepare(
        `INSERT INTO shop_order
          (id, user_id, item_id, item_name, item_description, delivery_note,
           quantity, unit_price, total_points, status, request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', ?, ?)`,
      ).bind(
        orderId,
        userId,
        item.id,
        item.name,
        item.description,
        item.deliveryNote,
        price,
        price,
        requestId,
        now,
      ),
      env.DB.prepare(
        `UPDATE point_account
         SET balance = balance - ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(price, now, userId),
      env.DB.prepare(
        "UPDATE shop_item SET stock = stock - 1, updated_at = ? WHERE id = ?",
      ).bind(now, item.id),
      env.DB.prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, created_at)
         VALUES (?, ?, ?, 'shop_redeem', ?, ?,
           (SELECT balance FROM point_account WHERE user_id = ?), ?)`,
      ).bind(
        transactionId,
        userId,
        -price,
        `兑换：${item.name}`,
        `shop:${orderId}`,
        userId,
        now,
      ),
    ]);
  } catch {
    const duplicate = await env.DB.prepare(
      `SELECT id FROM shop_order
       WHERE user_id = ? AND request_id = ?`,
    )
      .bind(userId, requestId)
      .first<{ id: string }>();
    if (duplicate) {
      return json({
        ok: true,
        duplicate: true,
        orderId: duplicate.id,
      });
    }
    return json(
      {
        error: "兑换失败，积分或库存可能已发生变化，请刷新后重试。",
      },
      409,
    );
  }

  const balance = await env.DB.prepare(
    "SELECT balance FROM point_account WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ balance: number }>();

  return json(
    {
      ok: true,
      orderId,
      balance: Number(balance?.balance ?? 0),
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

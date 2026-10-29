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

interface OrderRow {
  id: string;
  userId: string;
  itemId: string;
  itemName: string;
  totalPoints: number;
  status: "pending" | "fulfilled" | "cancelled";
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有订单管理权限。" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const input = payload as {
    orderId?: unknown;
    action?: unknown;
    note?: unknown;
  };
  const orderId =
    typeof input.orderId === "string" ? input.orderId.trim() : "";
  const action = input.action;
  const note = typeof input.note === "string" ? input.note.trim() : "";

  if (!/^[a-zA-Z0-9-]{8,80}$/.test(orderId)) {
    return json({ error: "订单标识无效。" }, 400);
  }
  if (action !== "fulfill" && action !== "cancel") {
    return json({ error: "订单操作无效。" }, 400);
  }
  if (note.length > 500) {
    return json({ error: "发放说明不能超过 500 个字符。" }, 400);
  }

  const order = await env.DB.prepare(
    `SELECT
       id, user_id AS userId, item_id AS itemId,
       item_name AS itemName, total_points AS totalPoints, status
     FROM shop_order WHERE id = ?`,
  )
    .bind(orderId)
    .first<OrderRow>();
  if (!order) return json({ error: "订单不存在。" }, 404);
  if (order.status !== "pending") {
    return json({ error: `订单当前状态为 ${order.status}，不能重复处理。` }, 409);
  }

  const now = Date.now();
  try {
    if (action === "fulfill") {
      const result = await env.DB.prepare(
        `UPDATE shop_order
         SET status = 'fulfilled', completed_at = ?,
             delivery_note = CASE WHEN ? = '' THEN delivery_note ELSE ? END
         WHERE id = ? AND status = 'pending'`,
      )
        .bind(now, note, note, order.id)
        .run();
      if (!result.meta.changes) {
        return json({ error: "订单状态已经变化，请刷新后重试。" }, 409);
      }
    } else {
      const refundId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE shop_order
           SET status = 'cancelled', completed_at = ?
           WHERE id = ?`,
        ).bind(now, order.id),
        env.DB.prepare(
          "UPDATE shop_item SET stock = stock + 1, updated_at = ? WHERE id = ?",
        ).bind(now, order.itemId),
        env.DB.prepare(
          `UPDATE point_account
           SET balance = balance + ?, updated_at = ?
           WHERE user_id = ?`,
        ).bind(order.totalPoints, now, order.userId),
        env.DB.prepare(
          `INSERT INTO point_transaction
            (id, user_id, amount, type, description, reference_id,
             balance_after, operator_user_id, created_at)
           VALUES (?, ?, ?, 'shop_refund', ?, ?,
             (SELECT balance FROM point_account WHERE user_id = ?), ?, ?)`,
        ).bind(
          refundId,
          order.userId,
          order.totalPoints,
          `兑换取消退款：${order.itemName}`,
          `shop-refund:${order.id}`,
          order.userId,
          session.user.id,
          now,
        ),
      ]);
    }
  } catch {
    return json(
      { error: "订单状态已经变化，请刷新后重试。" },
      409,
    );
  }

  return json({
    ok: true,
    orderId: order.id,
    status: action === "fulfill" ? "fulfilled" : "cancelled",
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

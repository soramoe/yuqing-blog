import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import type {
  AdminShopResponse,
  ShopItem,
  ShopOrder,
} from "../../../../src/lib/shop";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有商城管理权限。" }, 403);
  }

  const [itemResult, orderResult, codeResult] = await Promise.all([
    env.DB.prepare(
      `SELECT
         id, name, description, cover_url AS coverUrl,
         price_points AS pricePoints, stock,
         per_user_limit AS perUserLimit, delivery_note AS deliveryNote,
         active, sort_order AS sortOrder
       FROM shop_item
       ORDER BY sort_order ASC, created_at ASC`,
    ).all<Omit<ShopItem, "redeemedByUser" | "active"> & { active: number }>(),
    env.DB.prepare(
      `SELECT
         o.id, o.item_id AS itemId, o.item_name AS itemName,
         o.item_description AS itemDescription,
         o.delivery_note AS deliveryNote,
         o.quantity, o.unit_price AS unitPrice,
         o.total_points AS totalPoints, o.status,
         o.created_at AS createdAt, o.completed_at AS completedAt,
         o.user_id AS userId, u.name AS userName, u.email AS userEmail
       FROM shop_order o
       JOIN user u ON u.id = o.user_id
       ORDER BY
         CASE o.status WHEN 'pending' THEN 0 WHEN 'fulfilled' THEN 1 ELSE 2 END,
         o.created_at DESC
       LIMIT 50`,
    ).all<ShopOrder & {
      userId: string;
      userName: string;
      userEmail: string;
    }>(),
    env.DB.prepare(
      `SELECT
         c.id, c.code_hint AS codeHint, c.amount, c.batch_id AS batchId,
         c.created_at AS createdAt, c.redeemed_at AS redeemedAt,
         u.name AS redeemedByName
       FROM point_redemption_code c
       LEFT JOIN user u ON u.id = c.redeemed_by_user_id
       ORDER BY c.created_at DESC
       LIMIT 40`,
    ).all<{
      id: string;
      codeHint: string;
      amount: number;
      batchId: string;
      createdAt: number;
      redeemedAt: number | null;
      redeemedByName: string | null;
    }>(),
  ]);

  return json({
    items: itemResult.results.map((item) => ({
      ...item,
      pricePoints: Number(item.pricePoints),
      stock: Number(item.stock),
      perUserLimit: Number(item.perUserLimit),
      sortOrder: Number(item.sortOrder),
      active: Boolean(item.active),
    })),
    orders: orderResult.results.map((order) => ({
      ...order,
      quantity: Number(order.quantity),
      unitPrice: Number(order.unitPrice),
      totalPoints: Number(order.totalPoints),
      createdAt: Number(order.createdAt),
      completedAt: order.completedAt ? Number(order.completedAt) : null,
    })),
    codes: codeResult.results.map((code) => ({
      ...code,
      amount: Number(code.amount),
      createdAt: Number(code.createdAt),
      redeemedAt: code.redeemedAt ? Number(code.redeemedAt) : null,
    })),
  } satisfies AdminShopResponse);
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

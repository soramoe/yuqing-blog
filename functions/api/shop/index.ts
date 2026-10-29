import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import type { ShopItem, ShopOrder, ShopResponse } from "../../../src/lib/shop";

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
  coverUrl: string | null;
  pricePoints: number;
  stock: number;
  perUserLimit: number;
  deliveryNote: string;
  active: number;
  sortOrder: number;
}

interface ShopOrderRow {
  id: string;
  itemId: string;
  itemName: string;
  itemDescription: string;
  deliveryNote: string;
  quantity: number;
  unitPrice: number;
  totalPoints: number;
  status: ShopOrder["status"];
  createdAt: number;
  completedAt: number | null;
}

interface BalanceRow {
  balance: number;
  totalEarned: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id ?? null;
  const itemRedemptions = new Map<string, number>();

  if (userId) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
       VALUES (?, 0, ?)`,
    )
      .bind(userId, Date.now())
      .run();

    const redemptions = await env.DB.prepare(
      `SELECT item_id AS itemId, COUNT(*) AS count
       FROM shop_order
       WHERE user_id = ? AND status IN ('pending', 'fulfilled')
       GROUP BY item_id`,
    )
      .bind(userId)
      .all<{ itemId: string; count: number }>();
    for (const row of redemptions.results) {
      itemRedemptions.set(row.itemId, Number(row.count));
    }
  }

  const itemResult = await env.DB.prepare(
    `SELECT
       id, name, description,
       cover_url AS coverUrl,
       price_points AS pricePoints,
       stock,
       per_user_limit AS perUserLimit,
       delivery_note AS deliveryNote,
       active,
       sort_order AS sortOrder
     FROM shop_item
     WHERE active = true
     ORDER BY sort_order ASC, created_at ASC`,
  ).all<ShopItemRow>();

  const items: ShopItem[] = itemResult.results.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    coverUrl: row.coverUrl,
    pricePoints: Number(row.pricePoints),
    stock: Number(row.stock),
    perUserLimit: Number(row.perUserLimit),
    deliveryNote: "",
    active: Boolean(row.active),
    sortOrder: Number(row.sortOrder),
    redeemedByUser: itemRedemptions.get(row.id) ?? 0,
  }));

  if (!userId) {
    return json({ items, user: null } satisfies ShopResponse);
  }

  const [balanceResult, orderResult] = await Promise.all([
    env.DB.prepare(
      `SELECT
         COALESCE((SELECT balance FROM point_account WHERE user_id = ?), 0) AS balance,
         COALESCE(
           (SELECT SUM(amount) FROM point_transaction
            WHERE user_id = ? AND amount > 0),
           0
         ) AS totalEarned`,
    )
      .bind(userId, userId)
      .first<BalanceRow>(),
    env.DB.prepare(
      `SELECT
         id,
         item_id AS itemId,
         item_name AS itemName,
         item_description AS itemDescription,
         delivery_note AS deliveryNote,
         quantity,
         unit_price AS unitPrice,
         total_points AS totalPoints,
         status,
         created_at AS createdAt,
         completed_at AS completedAt
       FROM shop_order
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
    )
      .bind(userId)
      .all<ShopOrderRow>(),
  ]);

  return json({
    items,
    user: {
      balance: Number(balanceResult?.balance ?? 0),
      totalEarned: Number(balanceResult?.totalEarned ?? 0),
      orders: orderResult.results.map((row) => ({
        ...row,
        quantity: Number(row.quantity),
        unitPrice: Number(row.unitPrice),
        totalPoints: Number(row.totalPoints),
        createdAt: Number(row.createdAt),
        completedAt: row.completedAt ? Number(row.completedAt) : null,
      })),
    },
  } satisfies ShopResponse);
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

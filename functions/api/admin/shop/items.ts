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
  if (!session?.user) return json({ error: "请先登录。" }, 401);
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有商品管理权限。" }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const input = payload as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  const coverUrl =
    typeof input.coverUrl === "string" ? input.coverUrl.trim() : "";
  const deliveryNote =
    typeof input.deliveryNote === "string" ? input.deliveryNote.trim() : "";
  const pricePoints =
    typeof input.pricePoints === "number"
      ? Math.trunc(input.pricePoints)
      : NaN;
  const stock =
    typeof input.stock === "number" ? Math.trunc(input.stock) : NaN;
  const perUserLimit =
    typeof input.perUserLimit === "number"
      ? Math.trunc(input.perUserLimit)
      : NaN;
  const sortOrder =
    typeof input.sortOrder === "number"
      ? Math.trunc(input.sortOrder)
      : NaN;
  const active = input.active === true;

  if (id && !/^[a-zA-Z0-9_-]{2,64}$/.test(id)) {
    return json({ error: "商品标识无效。" }, 400);
  }
  if (name.length < 2 || name.length > 60) {
    return json({ error: "商品名称需要 2 到 60 个字符。" }, 400);
  }
  if (description.length < 2 || description.length > 500) {
    return json({ error: "商品描述需要 2 到 500 个字符。" }, 400);
  }
  if (
    coverUrl &&
    (coverUrl.length > 500 || !/^(https:\/\/|\/)/.test(coverUrl))
  ) {
    return json({ error: "封面地址无效。" }, 400);
  }
  if (deliveryNote.length > 500) {
    return json({ error: "发放说明不能超过 500 个字符。" }, 400);
  }
  if (!Number.isSafeInteger(pricePoints) || pricePoints < 1 || pricePoints > 100_000) {
    return json({ error: "积分价格必须是 1 到 100000 的整数。" }, 400);
  }
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1_000_000) {
    return json({ error: "库存必须是 0 到 1000000 的整数。" }, 400);
  }
  if (
    !Number.isSafeInteger(perUserLimit) ||
    perUserLimit < 1 ||
    perUserLimit > 10
  ) {
    return json({ error: "每人限兑数量必须是 1 到 10。" }, 400);
  }
  if (!Number.isSafeInteger(sortOrder) || Math.abs(sortOrder) > 10_000) {
    return json({ error: "排序值无效。" }, 400);
  }

  const now = Date.now();
  const itemId = id || crypto.randomUUID();
  if (id) {
    const result = await env.DB.prepare(
      `UPDATE shop_item
       SET name = ?, description = ?, cover_url = ?, price_points = ?,
           stock = ?, per_user_limit = ?, delivery_note = ?,
           active = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        name,
        description,
        coverUrl || null,
        pricePoints,
        stock,
        perUserLimit,
        deliveryNote,
        active,
        sortOrder,
        now,
        id,
      )
      .run();
    if (!result.meta.changes) {
      return json({ error: "商品不存在。" }, 404);
    }
  } else {
    await env.DB.prepare(
      `INSERT INTO shop_item
        (id, name, description, cover_url, price_points, stock,
         per_user_limit, delivery_note, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        itemId,
        name,
        description,
        coverUrl || null,
        pricePoints,
        stock,
        perUserLimit,
        deliveryNote,
        active,
        sortOrder,
        now,
        now,
      )
      .run();
  }

  return json({ ok: true, itemId }, id ? 200 : 201);
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

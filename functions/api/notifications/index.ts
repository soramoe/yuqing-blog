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

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: number | null;
  createdAt: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录。", code: "auth" }, 401);
  }

  const [items, unread] = await Promise.all([
    env.DB.prepare(
      `SELECT id, type, title, body, link,
              read_at AS readAt, created_at AS createdAt
       FROM notification
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
    )
      .bind(session.user.id)
      .all<NotificationRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM notification
       WHERE user_id = ? AND read_at IS NULL`,
    )
      .bind(session.user.id)
      .first<{ total: number }>(),
  ]);

  return json({
    unread: Number(unread?.total ?? 0),
    items: items.results.map((row) => ({
      ...row,
      readAt: row.readAt ? Number(row.readAt) : null,
      createdAt: Number(row.createdAt),
    })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录。", code: "auth" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "参数格式无效。" }, 400);
  }
  const input =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const now = Date.now();

  if (input.all === true) {
    await env.DB.prepare(
      `UPDATE notification SET read_at = ?
       WHERE user_id = ? AND read_at IS NULL`,
    )
      .bind(now, session.user.id)
      .run();
    return json({ ok: true });
  }

  const id = typeof input.id === "string" ? input.id : "";
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    return json({ error: "通知标识无效。" }, 400);
  }
  await env.DB.prepare(
    `UPDATE notification SET read_at = ?
     WHERE id = ? AND user_id = ? AND read_at IS NULL`,
  )
    .bind(now, id, session.user.id)
    .run();
  return json({ ok: true });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, POST" },
  });
};

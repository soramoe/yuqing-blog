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

const isGalleryKey = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(gallery|cover):[^\s]{1,180}$/.test(value);

const authorize = async (request: Request, env: Env) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return { response: json({ error: "请求来源不受信任。" }, 403) };
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { response: json({ error: "请先登录。" }, 401) };
  }
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return { response: json({ error: "你没有图库管理权限。" }, 403) };
  }
  return { session };
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const key = (payload as { key?: unknown }).key;
  const titleValue = (payload as { title?: unknown }).title;
  if (!isGalleryKey(key)) {
    return json({ error: "图库图片标识无效。" }, 400);
  }
  const title =
    typeof titleValue === "string" && titleValue.trim()
      ? titleValue.trim().slice(0, 120)
      : "未命名图片";

  await env.DB.prepare(
    `INSERT INTO gallery_hidden_item (item_key, title, hidden_by, hidden_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(item_key) DO UPDATE SET
       title = excluded.title,
       hidden_by = excluded.hidden_by,
       hidden_at = excluded.hidden_at`,
  )
    .bind(key, title, authorized.session.user.id, Date.now())
    .run();
  return json({ ok: true, hidden: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;

  const key = new URL(request.url).searchParams.get("key");
  if (!isGalleryKey(key)) {
    return json({ error: "图库图片标识无效。" }, 400);
  }
  await env.DB.prepare("DELETE FROM gallery_hidden_item WHERE item_key = ?")
    .bind(key)
    .run();
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  if (context.request.method === "DELETE") {
    return onRequestDelete(context);
  }
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST, DELETE" },
  });
};

import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import { galleryR2Keys } from "../../../../src/lib/gallery-upload-server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const authorize = async (
  request: Request,
  env: Env,
  id: string,
) => {
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

  const image = await env.DB.prepare(
    "SELECT base_name AS baseName, status FROM gallery_upload WHERE id = ?",
  )
    .bind(id)
    .first<{ baseName: string; status: string }>();
  if (!image) {
    return { response: json({ error: "图片记录不存在。" }, 404) };
  }
  return { session, image };
};

export const onRequestPatch: PagesFunction<
  Env,
  string,
  { id: string }
> = async ({ request, env, params }) => {
  const id = String(params.id ?? "");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    return json({ error: "图片标识无效。" }, 400);
  }
  const authorized = await authorize(request, env, id);
  if ("response" in authorized) return authorized.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const status = (payload as { status?: unknown }).status;
  if (status !== "approved" && status !== "rejected") {
    return json({ error: "审核状态无效。" }, 400);
  }
  if (authorized.image.status === "deleted") {
    return json({ error: "已删除的图片不能恢复。" }, 409);
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE gallery_upload
     SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(status, authorized.session.user.id, now, now, id)
    .run();
  return json({ ok: true, status });
};

export const onRequestDelete: PagesFunction<
  Env,
  string,
  { id: string }
> = async ({ request, env, params }) => {
  const id = String(params.id ?? "");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    return json({ error: "图片标识无效。" }, 400);
  }
  const authorized = await authorize(request, env, id);
  if ("response" in authorized) return authorized.response;
  if (authorized.image.status === "deleted") {
    return new Response(null, { status: 204 });
  }

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE gallery_upload
     SET status = 'deleted', reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(authorized.session.user.id, now, now, id)
    .run();

  const keys = galleryR2Keys(authorized.image.baseName);
  await Promise.all([
    env.MEDIA_BUCKET.delete([...keys.public, keys.preview]),
    env.MEDIA_PRIVATE_BUCKET.delete(keys.private),
  ]);
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
};

export const onRequest: PagesFunction<
  Env,
  string,
  { id: string }
> = (context) => {
  if (context.request.method === "PATCH") {
    return onRequestPatch(context);
  }
  if (context.request.method === "DELETE") {
    return onRequestDelete(context);
  }
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "PATCH, DELETE" },
  });
};

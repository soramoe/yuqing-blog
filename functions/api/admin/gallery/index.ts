import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import { listAdminGalleryUploads } from "../../../../src/lib/gallery-upload-server";

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
    return json({ error: "你没有图库管理权限。" }, 403);
  }

  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  if (!["pending", "approved", "rejected", "deleted", "all"].includes(status)) {
    return json({ error: "图库状态无效。" }, 400);
  }
  return json({ images: await listAdminGalleryUploads(env.DB, status) });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

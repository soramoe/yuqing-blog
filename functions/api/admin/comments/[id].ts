import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import {
  isCommentAdmin,
  type CommentStatus,
} from "../../../../src/lib/comment-admin";
import { isCommentId } from "../../../../src/lib/comment-utils";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestPatch: PagesFunction<
  Env,
  string,
  { id: string }
> = async ({ request, env, params }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录。" }, 401);
  }
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有评论审核权限。" }, 403);
  }

  const id = String(params.id ?? "");
  if (!isCommentId(id)) {
    return json({ error: "评论标识无效。" }, 400);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }
  const nextStatus = (payload as { status?: unknown }).status;
  if (
    nextStatus !== "visible" &&
    nextStatus !== "hidden" &&
    nextStatus !== "deleted"
  ) {
    return json({ error: "评论状态无效。" }, 400);
  }

  const current = await env.DB.prepare(
    "SELECT status FROM comment WHERE id = ?",
  )
    .bind(id)
    .first<{ status: CommentStatus }>();
  if (!current) {
    return json({ error: "评论不存在。" }, 404);
  }
  if (current.status === "deleted" && nextStatus !== "deleted") {
    return json({ error: "已永久删除的评论不能恢复。" }, 409);
  }

  const now = Date.now();
  const sql =
    nextStatus === "deleted"
      ? "UPDATE comment SET status = ?, body = '', updated_at = ? WHERE id = ?"
      : "UPDATE comment SET status = ?, updated_at = ? WHERE id = ?";
  const result = await env.DB.prepare(sql)
    .bind(nextStatus, now, id)
    .run();
  if (!result.success) {
    return json({ error: "评论状态更新失败。" }, 500);
  }

  return json({ ok: true, status: nextStatus });
};

export const onRequest: PagesFunction<
  Env,
  string,
  { id: string }
> = (context) => {
  if (context.request.method === "PATCH") {
    return onRequestPatch(context);
  }
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "PATCH" },
  });
};

import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import { isCommentId } from "../../../src/lib/comment-utils";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestDelete: PagesFunction<
  Env,
  string,
  { id: string }
> = async ({ request, env, params }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const id = String(params.id ?? "");
  if (!isCommentId(id)) {
    return json({ error: "评论标识无效。" }, 400);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录。" }, 401);
  }

  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE comment
     SET body = '', status = 'deleted', updated_at = ?
     WHERE id = ? AND user_id = ? AND status = 'visible'`,
  )
    .bind(now, id, session.user.id)
    .run();

  if (!result.success || Number(result.meta.changes ?? 0) === 0) {
    return json({ error: "评论不存在或你没有删除权限。" }, 404);
  }

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
  if (context.request.method === "DELETE") {
    return onRequestDelete(context);
  }
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "DELETE" },
  });
};

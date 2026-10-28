import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import { isCommentAdmin } from "../../../src/lib/comment-admin";

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
  if (!session?.user) {
    return json({ error: "请先登录。" }, 401);
  }

  return json({
    isAdmin: isCommentAdmin(
      env.COMMENT_ADMIN_USER_IDS,
      session.user.id,
    ),
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

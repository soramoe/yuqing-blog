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

interface AssetRow {
  userId: string;
  r2Key: string;
  contentType: string;
  permission: string;
}

export const onRequestGet: PagesFunction<
  Env,
  string,
  { jobId: string }
> = async ({ request, env, params }) => {
  const jobId = String(params.jobId ?? "");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(jobId)) {
    return json({ error: "图片标识无效。" }, 400);
  }
  const row = await env.DB.prepare(
    `SELECT
      j.user_id AS userId,
      a.r2_key AS r2Key,
      a.content_type AS contentType,
      j.permission
     FROM image_job j
     INNER JOIN image_asset a ON a.job_id = j.id
     WHERE j.id = ? AND j.status = 'succeeded'`,
  )
    .bind(jobId)
    .first<AssetRow>();
  if (!row) return json({ error: "图片不存在。" }, 404);

  if (row.permission !== "public") {
    const auth = createAuth(env, new URL(request.url));
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return json({ error: "请先登录。" }, 401);
    const admin = isCommentAdmin(
      env.COMMENT_ADMIN_USER_IDS,
      session.user.id,
    );
    if (!admin && row.userId !== session.user.id) {
      return json({ error: "你没有查看这张图片的权限。" }, 403);
    }
  }

  const bucket =
    row.permission === "public"
      ? env.MEDIA_BUCKET
      : env.MEDIA_PRIVATE_BUCKET;
  const object = await bucket.get(row.r2Key);
  if (!object) return json({ error: "图片文件不存在。" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": row.contentType,
      "Cache-Control":
        row.permission === "public"
          ? "public, max-age=31536000, immutable"
          : "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const onRequest: PagesFunction<
  Env,
  string,
  { jobId: string }
> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

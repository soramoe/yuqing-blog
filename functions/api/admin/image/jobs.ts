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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录。" }, 401);
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有生图管理权限。" }, 403);
  }
  const result = await env.DB.prepare(
    `SELECT
      j.id,
      j.feature,
      j.source_id AS sourceId,
      j.quality,
      j.status,
      j.points_cost AS pointsCost,
      j.provider_id AS providerId,
      j.model,
      j.attempts,
      j.error_code AS errorCode,
      j.error_message AS errorMessage,
      j.created_at AS createdAt,
      j.completed_at AS completedAt,
      u.name AS userName,
      a.r2_key AS r2Key,
      a.width,
      a.height
     FROM image_job j
     INNER JOIN user u ON u.id = j.user_id
     LEFT JOIN image_asset a ON a.job_id = j.id
     ORDER BY j.created_at DESC
     LIMIT 50`,
  ).all();
  return json({
    jobs: result.results.map((row) => ({
      ...row,
      pointsCost: Number(row.pointsCost),
      attempts: Number(row.attempts),
      createdAt: Number(row.createdAt),
      completedAt: row.completedAt ? Number(row.completedAt) : null,
      width: row.width ? Number(row.width) : null,
      height: row.height ? Number(row.height) : null,
    })),
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

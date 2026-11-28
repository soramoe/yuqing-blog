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

// 当前用户在「AI 生图」页的全部生成记录（含成功/失败/排队中），供历史页展示
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

  const result = await env.DB.prepare(
    `SELECT j.id, j.status, j.prompt, j.points_cost AS pointsCost,
            j.error_message AS errorMessage, j.width, j.height,
            j.created_at AS createdAt,
            a.r2_key IS NOT NULL AS hasAsset
     FROM image_job j
     LEFT JOIN image_asset a ON a.job_id = j.id
     WHERE j.user_id = ? AND j.feature = 'image_studio'
     ORDER BY j.created_at DESC
     LIMIT 60`,
  )
    .bind(session.user.id)
    .all<{
      id: string;
      status: string;
      prompt: string;
      pointsCost: number;
      errorMessage: string | null;
      width: number | null;
      height: number | null;
      createdAt: number;
      hasAsset: number;
    }>();

  const items = result.results.map((row) => ({
    id: row.id,
    status: row.status,
    prompt: row.prompt,
    pointsCost: Number(row.pointsCost),
    errorMessage: row.errorMessage,
    width: row.width ? Number(row.width) : null,
    height: row.height ? Number(row.height) : null,
    createdAt: Number(row.createdAt),
    url: row.hasAsset ? `/api/image/asset/${row.id}` : null,
  }));

  return json({ items });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

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

const authorize = async (request: Request, env: Env) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return { response: json({ error: "请先登录。" }, 401) };
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return { response: json({ error: "你没有故事审核权限。" }, 403) };
  }
  return { session };
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;
  const status =
    new URL(request.url).searchParams.get("status") ?? "pending";
  if (!["pending", "approved", "rejected", "all"].includes(status)) {
    return json({ error: "审核状态无效。" }, 400);
  }
  const statement = env.DB.prepare(
    `SELECT
      p.id, p.slug, p.title, p.summary, p.status,
      p.template_id AS templateId, p.mode_id AS modeId,
      p.difficulty_id AS difficultyId, p.style,
      p.read_count AS readCount, p.tip_total AS tipTotal,
      p.created_at AS createdAt, p.updated_at AS updatedAt,
      u.name AS authorName
     FROM story_publication p
     INNER JOIN user u ON u.id = p.author_user_id
     ${status === "all" ? "" : "WHERE p.status = ?"}
     ORDER BY p.updated_at DESC
     LIMIT 100`,
  );
  const result = await (status === "all"
    ? statement
    : statement.bind(status)
  ).all();
  return json({
    stories: result.results.map((row) => ({
      ...row,
      readCount: Number(row.readCount),
      tipTotal: Number(row.tipTotal),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    })),
  });
};

export const onRequestPatch: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "审核内容格式无效。" }, 400);
  }
  const input = payload as { id?: unknown; status?: unknown };
  const id = typeof input.id === "string" ? input.id : "";
  const status = input.status;
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) {
    return json({ error: "故事标识无效。" }, 400);
  }
  if (status !== "approved" && status !== "rejected") {
    return json({ error: "审核状态无效。" }, 400);
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE story_publication
     SET status = ?, reviewed_by = ?, reviewed_at = ?,
         published_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      status,
      authorized.session.user.id,
      now,
      status === "approved" ? now : null,
      now,
      id,
    )
    .run();
  return json({ ok: true, status });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, PATCH" },
  });
};

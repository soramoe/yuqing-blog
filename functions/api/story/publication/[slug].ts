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

export const onRequestGet: PagesFunction<
  Env,
  string,
  { slug: string }
> = async ({ request, env, params }) => {
  const slug = String(params.slug ?? "");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(slug)) {
    return json({ error: "故事标识无效。" }, 400);
  }
  const row = await env.DB.prepare(
    `SELECT
      p.id,
      p.slug,
      p.title,
      p.summary,
      p.template_id AS templateId,
      p.mode_id AS modeId,
      p.difficulty_id AS difficultyId,
      p.style,
      p.cover_url AS coverUrl,
      p.content_json AS contentJson,
      p.status,
      p.read_count AS readCount,
      p.tip_total AS tipTotal,
      p.author_user_id AS authorUserId,
      p.published_at AS publishedAt,
      u.name AS authorName,
      u.image AS authorImage
     FROM story_publication p
     INNER JOIN user u ON u.id = p.author_user_id
     WHERE p.slug = ?`,
  )
    .bind(slug)
    .first<Record<string, unknown>>();
  if (!row) return json({ error: "故事不存在。" }, 404);

  if (row.status !== "approved") {
    const auth = createAuth(env, new URL(request.url));
    const session = await auth.api.getSession({ headers: request.headers });
    const isAdmin = session?.user
      ? isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)
      : false;
    const isAuthor = session?.user?.id === row.authorUserId;
    if (!isAdmin && !isAuthor) {
      return json({ error: "故事正在等待审核。" }, 403);
    }
  }

  let content: unknown = null;
  try {
    content = JSON.parse(String(row.contentJson));
  } catch {
    return json({ error: "故事内容损坏。" }, 500);
  }
  if (row.status === "approved") {
    await env.DB.prepare(
      "UPDATE story_publication SET read_count = read_count + 1 WHERE id = ?",
    )
      .bind(row.id)
      .run();
  }
  const [commentCount, tipMessages] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM comment
       WHERE status = 'visible'
         AND (post_slug = ? OR post_slug LIKE ?)`,
    )
      .bind(`story-${row.id}`, `story-${row.id}-chapter-%`)
      .first<{ total: number }>(),
    env.DB.prepare(
      `SELECT
        t.amount,
        t.message,
        t.created_at AS createdAt,
        u.name AS userName
       FROM story_tip t
       INNER JOIN user u ON u.id = t.from_user_id
       WHERE t.publication_id = ? AND t.message IS NOT NULL
         AND TRIM(t.message) != ''
       ORDER BY t.created_at DESC
       LIMIT 10`,
    )
      .bind(row.id)
      .all<{
        amount: number;
        message: string;
        createdAt: number;
        userName: string;
      }>(),
  ]);
  return json({
    story: {
      ...row,
      contentJson: undefined,
      content,
      readCount: Number(row.readCount) + (row.status === "approved" ? 1 : 0),
      tipTotal: Number(row.tipTotal),
      publishedAt: row.publishedAt ? Number(row.publishedAt) : null,
      commentCount: Number(commentCount?.total ?? 0),
      tipMessages: tipMessages.results.map((tip) => ({
        ...tip,
        amount: Number(tip.amount),
        createdAt: Number(tip.createdAt),
      })),
    },
  });
};

export const onRequest: PagesFunction<
  Env,
  string,
  { slug: string }
> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

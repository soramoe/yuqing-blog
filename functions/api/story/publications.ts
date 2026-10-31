import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  getStoryDifficulty,
  getStoryMode,
  getStoryTemplate,
} from "../../../src/lib/story-templates";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const sameOrigin = (request: Request) => {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
};

const normalizeCoverUrl = (value: unknown) => {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || url.length > 500) return null;
  if (url.startsWith("/media/") || url.startsWith("/images/")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
};

const listPublic = async (db: D1Database) => {
  const result = await db
    .prepare(
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
        p.read_count AS readCount,
        p.tip_total AS tipTotal,
        p.published_at AS publishedAt,
        u.name AS authorName,
        u.image AS authorImage
       FROM story_publication p
       INNER JOIN user u ON u.id = p.author_user_id
       WHERE p.status = 'approved'
       ORDER BY p.published_at DESC, p.id DESC
       LIMIT 100`,
    )
    .all();
  return result.results.map((row) => ({
    ...row,
    readCount: Number(row.readCount),
    tipTotal: Number(row.tipTotal),
    publishedAt: Number(row.publishedAt),
  }));
};

const listMine = async (db: D1Database, userId: string) => {
  const result = await db
    .prepare(
      `SELECT
        id,
        slug,
        title,
        summary,
        status,
        cover_url AS coverUrl,
        tip_total AS tipTotal,
        read_count AS readCount,
        created_at AS createdAt,
        updated_at AS updatedAt
       FROM story_publication
       WHERE author_user_id = ?
       ORDER BY updated_at DESC
       LIMIT 50`,
    )
    .bind(userId)
    .all();
  return result.results.map((row) => ({
    ...row,
    tipTotal: Number(row.tipTotal),
    readCount: Number(row.readCount),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }));
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope === "mine") {
    const auth = createAuth(env, new URL(request.url));
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return json({ error: "请先登录。" }, 401);
    return json({ stories: await listMine(env.DB, session.user.id) });
  }
  return json({ stories: await listPublic(env.DB) });
};

export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  if (!sameOrigin(request)) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录后再投稿。" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "投稿内容格式无效。" }, 400);
  }
  const input = payload as {
    title?: unknown;
    summary?: unknown;
    coverUrl?: unknown;
    data?: unknown;
  };
  const title =
    typeof input.title === "string" ? input.title.trim().slice(0, 80) : "";
  const summary =
    typeof input.summary === "string"
      ? input.summary.trim().slice(0, 300)
      : "";
  const coverUrl = normalizeCoverUrl(input.coverUrl);
  if (title.length < 2 || summary.length < 6) {
    return json({ error: "请填写至少 2 字标题和 6 字简介。" }, 400);
  }
  if (!input.data || typeof input.data !== "object") {
    return json({ error: "没有可发布的剧情数据。" }, 400);
  }
  const data = input.data as Record<string, unknown>;
  const templateId =
    typeof data.templateId === "string" ? data.templateId : "";
  const modeId = typeof data.modeId === "string" ? data.modeId : "";
  const style = typeof data.style === "string" ? data.style : "";
  const sessionId =
    typeof data.sessionId === "string" ? data.sessionId : "";
  const history = Array.isArray(data.history) ? data.history : [];
  if (
    !getStoryTemplate(templateId) ||
    !getStoryMode(templateId, modeId) ||
    !style ||
    !sessionId ||
    history.length === 0
  ) {
    return json({ error: "剧情快照不完整，至少需要一回合正文。" }, 400);
  }
  const contentJson = JSON.stringify({
    ...data,
    keyMode: undefined,
    undoStack: undefined,
    trialRemaining: undefined,
    pointsSpent: undefined,
  });
  if (new TextEncoder().encode(contentJson).byteLength > 900_000) {
    return json({ error: "故事内容过大，暂时无法发布。" }, 413);
  }

  const difficulty = getStoryDifficulty(
    data.difficultyId,
    data.customDifficulty,
  );
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT id, slug FROM story_publication
     WHERE author_user_id = ? AND source_session_id = ?`,
  )
    .bind(session.user.id, sessionId)
    .first<{ id: string; slug: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const slug = existing?.slug ?? crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO story_publication
      (id, slug, source_session_id, author_user_id, title, summary,
       template_id, mode_id, difficulty_id, style, cover_url,
       content_json, status,
       read_count, tip_total, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?, NULL)
     ON CONFLICT(author_user_id, source_session_id) DO UPDATE SET
       title = excluded.title,
       summary = excluded.summary,
       difficulty_id = excluded.difficulty_id,
       style = excluded.style,
       cover_url = excluded.cover_url,
       content_json = excluded.content_json,
       status = 'pending',
       reviewed_by = NULL,
       reviewed_at = NULL,
       updated_at = excluded.updated_at,
       published_at = NULL`,
  )
    .bind(
      id,
      slug,
      sessionId,
      session.user.id,
      title,
      summary,
      templateId,
      modeId,
      difficulty.id,
      style,
      coverUrl,
      contentJson,
      now,
      now,
    )
    .run();

  return json(
    {
      story: {
        id,
        slug,
        title,
        summary,
        status: "pending",
      },
    },
    201,
  );
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, POST" },
  });
};

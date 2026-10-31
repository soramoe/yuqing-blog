import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import {
  COMMENT_MAX_LENGTH,
  COMMENT_PAGE_SIZE,
  isCommentId,
  isPostSlug,
  normalizeCommentBody,
  type CommentApiItem,
  type CommentApiResponse,
} from "../../../src/lib/comment-utils";

interface CommentRow {
  id: string;
  body: string;
  createdAt: number;
  parentId: string | null;
  replyToName: string | null;
  userId: string;
  userName: string;
  userImage: string | null;
}

interface CountRow {
  total: number;
}

interface RateRow {
  total: number;
  latest: number | null;
}

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

const parseCursor = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/^(\d{10,16})_([a-z0-9-]{1,64})$/i);
  if (!match) return null;
  return { createdAt: Number(match[1]), id: match[2] };
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const postSlug = url.searchParams.get("post");
  if (!isPostSlug(postSlug)) {
    return json({ error: "文章标识无效。" }, 400);
  }

  const cursorValue = url.searchParams.get("cursor");
  const cursor = parseCursor(cursorValue);
  if (cursorValue && !cursor) {
    return json({ error: "分页参数无效。" }, 400);
  }

  const sessionCookie = request.headers.get("cookie") ?? "";
  const session =
    /(?:better-auth|session_token)/i.test(sessionCookie)
      ? await createAuth(env, url).api.getSession({
          headers: request.headers,
        })
      : null;
  const userId = session?.user.id ?? null;

  const cursorClause = cursor
    ? "AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))"
    : "";
  const values = cursor
    ? [
        postSlug,
        cursor.createdAt,
        cursor.createdAt,
        cursor.id,
        COMMENT_PAGE_SIZE + 1,
      ]
    : [postSlug, COMMENT_PAGE_SIZE + 1];

  const [commentsResult, countResult] = await Promise.all([
    env.DB.prepare(
      `SELECT
        c.id,
        c.body,
        c.created_at AS createdAt,
        c.parent_id AS parentId,
        c.user_id AS userId,
        u.name AS userName,
        u.image AS userImage,
        pu.name AS replyToName
      FROM comment c
      INNER JOIN user u ON u.id = c.user_id
      LEFT JOIN comment p ON p.id = c.parent_id AND p.status = 'visible'
      LEFT JOIN user pu ON pu.id = p.user_id
      WHERE c.post_slug = ? AND c.status = 'visible'
      ${cursorClause}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ?`,
    )
      .bind(...values)
      .all<CommentRow>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS total FROM comment WHERE post_slug = ? AND status = 'visible'",
    )
      .bind(postSlug)
      .first<CountRow>(),
  ]);

  const hasMore = commentsResult.results.length > COMMENT_PAGE_SIZE;
  const rows = commentsResult.results.slice(0, COMMENT_PAGE_SIZE);
  const last = rows.at(-1);
  const response: CommentApiResponse = {
    comments: rows.map<CommentApiItem>((row) => ({
      id: row.id,
      body: row.body,
      createdAt: Number(row.createdAt),
      parentId: row.parentId,
      replyToName: row.replyToName,
      canDelete: row.userId === userId,
      user: {
        name: row.userName,
        image: row.userImage,
      },
    })),
    nextCursor:
      hasMore && last ? `${Number(last.createdAt)}_${last.id}` : null,
    total: Number(countResult?.total ?? 0),
  };

  return json(response);
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
  if (!session?.user) {
    return json({ error: "请先登录后再发表评论。" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "评论内容格式无效。" }, 400);
  }

  const input = payload as {
    postSlug?: unknown;
    body?: unknown;
    parentId?: unknown;
  };
  const postSlug = input.postSlug;
  const body = normalizeCommentBody(input.body);
  const bodyLength = Array.from(body).length;

  if (!isPostSlug(postSlug)) {
    return json({ error: "文章标识无效。" }, 400);
  }
  if (bodyLength === 0) {
    return json({ error: "评论内容不能为空。" }, 400);
  }
  if (bodyLength > COMMENT_MAX_LENGTH) {
    return json(
      { error: `评论不能超过 ${COMMENT_MAX_LENGTH} 个字符。` },
      400,
    );
  }

  const parentId =
    typeof input.parentId === "string" && input.parentId.length > 0
      ? input.parentId
      : null;
  if (parentId && !isCommentId(parentId)) {
    return json({ error: "回复目标无效。" }, 400);
  }

  if (parentId) {
    const parent = await env.DB.prepare(
      `SELECT c.id
       FROM comment c
       WHERE c.id = ? AND c.post_slug = ? AND c.status = 'visible'`,
    )
      .bind(parentId, postSlug)
      .first<{ id: string }>();
    if (!parent) {
      return json({ error: "要回复的评论不存在。" }, 404);
    }
  }

  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;
  const rate = await env.DB.prepare(
    `SELECT COUNT(*) AS total, MAX(created_at) AS latest
     FROM comment
     WHERE user_id = ? AND created_at >= ? AND status != 'deleted'`,
  )
    .bind(session.user.id, tenMinutesAgo)
    .first<RateRow>();
  const latest = Number(rate?.latest ?? 0);

  if (latest > now - 15_000) {
    return json(
      { error: "评论太快了，请等待 15 秒后再试。", retryAfter: 15 },
      429,
    );
  }
  if (Number(rate?.total ?? 0) >= 8) {
    return json(
      { error: "10 分钟内最多发表 8 条评论，请稍后再试。", retryAfter: 600 },
      429,
    );
  }

  const id = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT INTO comment
      (id, post_slug, user_id, body, parent_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'visible', ?, ?)`,
  )
    .bind(id, postSlug, session.user.id, body, parentId, now, now)
    .run();

  if (!result.success) {
    return json({ error: "评论保存失败，请稍后重试。" }, 500);
  }

  let replyToName: string | null = null;
  if (parentId) {
    const parentUser = await env.DB.prepare(
      `SELECT u.name
       FROM comment c
       INNER JOIN user u ON u.id = c.user_id
       WHERE c.id = ?`,
    )
      .bind(parentId)
      .first<{ name: string }>();
    replyToName = parentUser?.name ?? null;
  }

  const item: CommentApiItem = {
    id,
    body,
    createdAt: now,
    parentId,
    replyToName,
    canDelete: true,
    user: {
      name: session.user.name,
      image: session.user.image ?? null,
    },
  };
  return json({ comment: item }, 201);
};

export const onRequest: PagesFunction<Env> = (context) => {
  switch (context.request.method) {
    case "GET":
      return onRequestGet(context);
    case "POST":
      return onRequestPost(context);
    default:
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
  }
};

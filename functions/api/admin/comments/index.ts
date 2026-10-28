import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import {
  isCommentAdmin,
  escapeLike,
  type AdminCommentItem,
  type AdminCommentsResponse,
  type CommentStatus,
  type CommentStatusFilter,
} from "../../../../src/lib/comment-admin";

interface AdminCommentRow {
  id: string;
  postSlug: string;
  body: string;
  status: CommentStatus;
  createdAt: number;
  updatedAt: number;
  userName: string;
  userImage: string | null;
}

interface CountRow {
  total: number;
}

const PAGE_SIZE = 30;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const parseCursor = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/^(\d{10,16})_([a-z0-9-]{1,64})$/i);
  return match ? { createdAt: Number(match[1]), id: match[2] } : undefined;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录。" }, 401);
  }
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return json({ error: "你没有评论审核权限。" }, 403);
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status") ?? "visible";
  const allowedStatuses: CommentStatusFilter[] = [
    "visible",
    "hidden",
    "deleted",
    "all",
  ];
  if (!allowedStatuses.includes(statusParam as CommentStatusFilter)) {
    return json({ error: "评论状态无效。" }, 400);
  }
  const status = statusParam as CommentStatusFilter;

  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const cursorValue = url.searchParams.get("cursor");
  const cursor = parseCursor(cursorValue);
  if (cursorValue && !cursor) {
    return json({ error: "分页参数无效。" }, 400);
  }

  const where: string[] = ["1 = 1"];
  const filterValues: unknown[] = [];
  if (status !== "all") {
    where.push("c.status = ?");
    filterValues.push(status);
  }
  if (query) {
    const term = `%${escapeLike(query)}%`;
    where.push(
      `(c.body LIKE ? ESCAPE '!'
        OR u.name LIKE ? ESCAPE '!'
        OR c.post_slug LIKE ? ESCAPE '!')`,
    );
    filterValues.push(term, term, term);
  }

  const whereSql = where.join(" AND ");
  const cursorSql = cursor
    ? "AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))"
    : "";
  const listValues = cursor
    ? [...filterValues, cursor.createdAt, cursor.createdAt, cursor.id, PAGE_SIZE + 1]
    : [...filterValues, PAGE_SIZE + 1];

  const [commentsResult, countResult] = await Promise.all([
    env.DB.prepare(
      `SELECT
        c.id,
        c.post_slug AS postSlug,
        c.body,
        c.status,
        c.created_at AS createdAt,
        c.updated_at AS updatedAt,
        u.name AS userName,
        u.image AS userImage
      FROM comment c
      INNER JOIN user u ON u.id = c.user_id
      WHERE ${whereSql}
      ${cursorSql}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ?`,
    )
      .bind(...listValues)
      .all<AdminCommentRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM comment c
       INNER JOIN user u ON u.id = c.user_id
       WHERE ${whereSql}`,
    )
      .bind(...filterValues)
      .first<CountRow>(),
  ]);

  const hasMore = commentsResult.results.length > PAGE_SIZE;
  const rows = commentsResult.results.slice(0, PAGE_SIZE);
  const last = rows.at(-1);
  const response: AdminCommentsResponse = {
    comments: rows.map<AdminCommentItem>((row) => ({
      id: row.id,
      postSlug: row.postSlug,
      body: row.body,
      status: row.status,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
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

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

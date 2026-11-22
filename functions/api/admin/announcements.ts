import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import { isCommentAdmin } from "../../../src/lib/comment-admin";
import type {
  Announcement,
  AnnouncementPlacement,
  AnnouncementType,
} from "../../../src/lib/announcements";
import { normalizeAnnouncementPath } from "../../../src/lib/announcements";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

interface AnnouncementRow extends Omit<Announcement, "active"> {
  active: number;
}

const allowedTypes = new Set<AnnouncementType>([
  "info",
  "success",
  "warning",
  "maintenance",
]);
const allowedPlacements = new Set<AnnouncementPlacement>([
  "site",
  "points",
  "shop",
  "custom",
]);

const optionalTimestamp = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = typeof value === "number" ? value : Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? Math.trunc(timestamp)
    : NaN;
};

const authorize = async (request: Request, env: Env) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return { error: json({ error: "请先登录。" }, 401) };
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return { error: json({ error: "你没有公告管理权限。" }, 403) };
  }
  return { userId: session.user.id };
};

const listAnnouncements = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT
         id, title, body, type, placement,
         priority, target_path AS targetPath,
         link_url AS linkUrl, link_text AS linkText, active,
         starts_at AS startsAt, ends_at AS endsAt,
         created_at AS createdAt, updated_at AS updatedAt
       FROM site_announcement
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .all<AnnouncementRow>();
  return result.results.map((row) => ({
    ...row,
    type: row.type as AnnouncementType,
    placement: row.targetPath
      ? "custom"
      : (row.placement as AnnouncementPlacement),
    priority: Number(row.priority),
    active: Boolean(row.active),
    startsAt: row.startsAt ? Number(row.startsAt) : null,
    endsAt: row.endsAt ? Number(row.endsAt) : null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }));
};

const parseBody = async (request: Request) => {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, POST, PATCH, DELETE" },
    });
  }

  const access = await authorize(request, env);
  if (access.error) return access.error;

  if (request.method === "GET") {
    return json({ announcements: await listAnnouncements(env.DB) });
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const input = await parseBody(request);
  if (!input) return json({ error: "请求内容格式无效。" }, 400);

  if (request.method === "PATCH") {
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id || typeof input.active !== "boolean") {
      return json({ error: "公告状态参数无效。" }, 400);
    }
    const result = await env.DB.prepare(
      `UPDATE site_announcement
       SET active = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(input.active ? 1 : 0, Date.now(), id)
      .run();
    if (!result.meta.changes) {
      return json({ error: "公告不存在。" }, 404);
    }
    return json({ ok: true, announcements: await listAnnouncements(env.DB) });
  }

  if (request.method === "DELETE") {
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id) return json({ error: "公告编号无效。" }, 400);
    const result = await env.DB.prepare(
      "DELETE FROM site_announcement WHERE id = ?",
    )
      .bind(id)
      .run();
    if (!result.meta.changes) {
      return json({ error: "公告不存在。" }, 404);
    }
    return json({ ok: true, announcements: await listAnnouncements(env.DB) });
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const type = input.type as AnnouncementType;
  const placement = input.placement as AnnouncementPlacement;
  const priority =
    input.priority === undefined || input.priority === null
      ? 0
      : Number(input.priority);
  const rawTargetPath =
    typeof input.targetPath === "string" ? input.targetPath : "";
  const targetPath =
    placement === "custom"
      ? normalizeAnnouncementPath(rawTargetPath)
      : null;
  const linkUrl =
    typeof input.linkUrl === "string" ? input.linkUrl.trim() : "";
  const linkText =
    typeof input.linkText === "string" ? input.linkText.trim() : "";
  const startsAt = optionalTimestamp(input.startsAt);
  const endsAt = optionalTimestamp(input.endsAt);

  if (title.length < 2 || title.length > 80) {
    return json({ error: "公告标题需要 2 到 80 个字符。" }, 400);
  }
  if (body.length < 2 || body.length > 500) {
    return json({ error: "公告内容需要 2 到 500 个字符。" }, 400);
  }
  if (!allowedTypes.has(type)) {
    return json({ error: "公告类型无效。" }, 400);
  }
  if (!allowedPlacements.has(placement)) {
    return json({ error: "公告展示位置无效。" }, 400);
  }
  if (
    !Number.isSafeInteger(priority) ||
    priority < 0 ||
    priority > 100
  ) {
    return json({ error: "公告优先级需要是 0 到 100 的整数。" }, 400);
  }
  if (
    placement === "custom" &&
    (!targetPath || targetPath === "/")
  ) {
    return json(
      { error: "指定页面公告需要填写有效的站内路径。" },
      400,
    );
  }
  if (
    linkUrl &&
    (linkUrl.length > 500 || !/^(https:\/\/|\/)/i.test(linkUrl))
  ) {
    return json({ error: "公告链接只允许站内路径或 HTTPS 地址。" }, 400);
  }
  if (linkText.length > 40) {
    return json({ error: "链接文字不能超过 40 个字符。" }, 400);
  }
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) {
    return json({ error: "公告时间格式无效。" }, 400);
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
    return json({ error: "结束时间必须晚于开始时间。" }, 400);
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const storedPlacement = placement === "custom" ? "site" : placement;
  await env.DB.prepare(
    `INSERT INTO site_announcement
      (id, title, body, type, placement, priority, target_path,
       link_url, link_text, active, starts_at, ends_at,
       created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      title,
      body,
      type,
      storedPlacement,
      priority,
      targetPath,
      linkUrl || null,
      linkText || (linkUrl ? "查看详情" : null),
      startsAt,
      endsAt,
      access.userId,
      now,
      now,
    )
    .run();

  return json(
    { ok: true, announcements: await listAnnouncements(env.DB) },
    201,
  );
};

import type { PagesFunction } from "@cloudflare/workers-types";
import type {
  Announcement,
  AnnouncementArchiveItem,
  AnnouncementPlacement,
  AnnouncementType,
} from "../../src/lib/announcements";
import { announcementMatchesPath } from "../../src/lib/announcements";

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

const mapAnnouncement = (row: AnnouncementRow): Announcement => ({
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
});

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const archive = url.searchParams.get("archive") === "1";
  const requestedPath = url.searchParams.get("path") ?? "/";
  const currentPath =
    requestedPath.startsWith("/") && !requestedPath.startsWith("//")
      ? requestedPath.split(/[?#]/, 1)[0]
      : "/";
  const now = Date.now();
  const result = await env.DB.prepare(
    `SELECT
       id, title, body, type, placement,
       priority, target_path AS targetPath,
       link_url AS linkUrl, link_text AS linkText, active,
       starts_at AS startsAt, ends_at AS endsAt,
       created_at AS createdAt, updated_at AS updatedAt
     FROM site_announcement
     WHERE ${
       archive
         ? `active = 1 OR (ends_at IS NOT NULL AND ends_at <= ?)`
         : `active = 1
            AND (starts_at IS NULL OR starts_at <= ?)
            AND (ends_at IS NULL OR ends_at > ?)`
     }
     ORDER BY priority DESC, created_at DESC
     LIMIT 100`,
  )
    .bind(...(archive ? [now] : [now, now]))
    .all<AnnouncementRow>();

  const announcements = result.results.map(mapAnnouncement);
  if (archive) {
    return json({
      announcements: announcements.map<AnnouncementArchiveItem>(
        (announcement) => ({
          ...announcement,
          expired: Boolean(
            announcement.endsAt && announcement.endsAt <= now,
          ),
        }),
      ),
    });
  }

  return json({
    announcements: announcements
      .filter((announcement) =>
        announcementMatchesPath(announcement, currentPath),
      )
      .slice(0, 20),
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
};

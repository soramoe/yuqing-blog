import type { PagesFunction } from "@cloudflare/workers-types";
import type {
  Announcement,
  AnnouncementPlacement,
  AnnouncementType,
} from "../../src/lib/announcements";

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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const requested = new URL(request.url).searchParams.get("placement");
  const placement: AnnouncementPlacement =
    requested === "points" || requested === "shop" ? requested : "site";
  const now = Date.now();
  const result = await env.DB.prepare(
    `SELECT
       id, title, body, type, placement,
       link_url AS linkUrl, link_text AS linkText, active,
       starts_at AS startsAt, ends_at AS endsAt,
       created_at AS createdAt, updated_at AS updatedAt
     FROM site_announcement
     WHERE active = 1
       AND (starts_at IS NULL OR starts_at <= ?)
       AND (ends_at IS NULL OR ends_at > ?)
       AND (placement = 'site' OR placement = ?)
     ORDER BY
       CASE WHEN placement = ? THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT 3`,
  )
    .bind(now, now, placement, placement)
    .all<AnnouncementRow>();

  return json({
    announcements: result.results.map((row) => ({
      ...row,
      type: row.type as AnnouncementType,
      placement: row.placement as AnnouncementPlacement,
      active: Boolean(row.active),
      startsAt: row.startsAt ? Number(row.startsAt) : null,
      endsAt: row.endsAt ? Number(row.endsAt) : null,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
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

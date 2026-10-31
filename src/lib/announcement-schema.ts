import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const siteAnnouncement = sqliteTable(
  "site_announcement",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    type: text("type").default("info").notNull(),
    placement: text("placement").default("site").notNull(),
    linkUrl: text("link_url"),
    linkText: text("link_text"),
    active: integer("active", { mode: "boolean" }).default(true).notNull(),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("site_announcement_active_created_idx").on(
      table.active,
      table.createdAt,
    ),
    check(
      "site_announcement_type_valid",
      sql`${table.type} in ('info', 'success', 'warning', 'maintenance')`,
    ),
    check(
      "site_announcement_placement_valid",
      sql`${table.placement} in ('site', 'points', 'shop')`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const comment = sqliteTable(
  "comment",
  {
    id: text("id").primaryKey(),
    postSlug: text("post_slug").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => comment.id,
      { onDelete: "set null" },
    ),
    status: text("status").default("visible").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("comment_post_created_idx").on(
      table.postSlug,
      table.status,
      table.createdAt,
    ),
    index("comment_user_created_idx").on(table.userId, table.createdAt),
    index("comment_parent_idx").on(table.parentId),
  ],
);

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const storyCloudSave = sqliteTable(
  "story_cloud_save",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slot: integer("slot").notNull(),
    title: text("title").notNull(),
    sessionId: text("session_id").notNull(),
    turnIndex: integer("turn_index").notNull(),
    dataJson: text("data_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("story_cloud_save_user_slot_unique").on(
      table.userId,
      table.slot,
    ),
    index("story_cloud_save_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);

export const storyPublication = sqliteTable(
  "story_publication",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    sourceSessionId: text("source_session_id").notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    templateId: text("template_id").notNull(),
    modeId: text("mode_id").notNull(),
    difficultyId: text("difficulty_id").notNull(),
    style: text("style").notNull(),
    contentJson: text("content_json").notNull(),
    status: text("status").default("pending").notNull(),
    readCount: integer("read_count").default(0).notNull(),
    tipTotal: integer("tip_total").default(0).notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("story_publication_author_session_unique").on(
      table.authorUserId,
      table.sourceSessionId,
    ),
    index("story_publication_status_published_idx").on(
      table.status,
      table.publishedAt,
    ),
    index("story_publication_author_updated_idx").on(
      table.authorUserId,
      table.updatedAt,
    ),
  ],
);

export const storyTip = sqliteTable(
  "story_tip",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => storyPublication.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    transactionRef: text("transaction_ref").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("story_tip_publication_created_idx").on(
      table.publicationId,
      table.createdAt,
    ),
    index("story_tip_from_created_idx").on(
      table.fromUserId,
      table.createdAt,
    ),
  ],
);

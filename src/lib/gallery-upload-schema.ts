import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const galleryUpload = sqliteTable(
  "gallery_upload",
  {
    id: text("id").primaryKey(),
    baseName: text("base_name").notNull().unique(),
    title: text("title").notNull(),
    source: text("source").notNull(),
    status: text("status").default("pending").notNull(),
    uploadDate: text("upload_date").notNull(),
    uploaderUserId: text("uploader_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    anonymousHash: text("anonymous_hash"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("gallery_upload_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    index("gallery_upload_user_created_idx").on(
      table.uploaderUserId,
      table.createdAt,
    ),
    index("gallery_upload_date_idx").on(table.uploadDate),
  ],
);

export const galleryUploadQuota = sqliteTable(
  "gallery_upload_quota",
  {
    subjectKey: text("subject_key").notNull(),
    uploadDate: text("upload_date").notNull(),
    used: integer("used").default(0).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.subjectKey, table.uploadDate],
    }),
  ],
);

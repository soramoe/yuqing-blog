import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const pointAccount = sqliteTable("point_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: integer("balance").default(0).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
});

export const dailyCheckin = sqliteTable(
  "daily_checkin",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    checkinDate: text("checkin_date").notNull(),
    points: integer("points").notNull(),
    transactionId: text("transaction_id").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("daily_checkin_user_date_unique").on(
      table.userId,
      table.checkinDate,
    ),
    index("daily_checkin_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const pointTransaction = sqliteTable(
  "point_transaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    type: text("type").notNull(),
    description: text("description").notNull(),
    referenceId: text("reference_id").notNull().unique(),
    balanceAfter: integer("balance_after").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("point_transaction_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

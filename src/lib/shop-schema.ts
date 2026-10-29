import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const shopItem = sqliteTable(
  "shop_item",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    coverUrl: text("cover_url"),
    pricePoints: integer("price_points").notNull(),
    stock: integer("stock").notNull(),
    perUserLimit: integer("per_user_limit").default(1).notNull(),
    deliveryNote: text("delivery_note").default("").notNull(),
    active: integer("active", { mode: "boolean" }).default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("shop_item_price_positive", sql`${table.pricePoints} > 0`),
    check("shop_item_stock_nonnegative", sql`${table.stock} >= 0`),
    check("shop_item_limit_positive", sql`${table.perUserLimit} > 0`),
    index("shop_item_active_sort_idx").on(table.active, table.sortOrder),
  ],
);

export const shopOrder = sqliteTable(
  "shop_order",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => shopItem.id, { onDelete: "restrict" }),
    itemName: text("item_name").notNull(),
    itemDescription: text("item_description").notNull(),
    deliveryNote: text("delivery_note").default("").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    unitPrice: integer("unit_price").notNull(),
    totalPoints: integer("total_points").notNull(),
    status: text("status").default("pending").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("shop_order_request_unique").on(table.userId, table.requestId),
    index("shop_order_user_created_idx").on(table.userId, table.createdAt),
    index("shop_order_status_created_idx").on(table.status, table.createdAt),
    check(
      "shop_order_status_valid",
      sql`${table.status} in ('pending', 'fulfilled', 'cancelled')`,
    ),
  ],
);

export const pointRedemptionCode = sqliteTable(
  "point_redemption_code",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    codeHint: text("code_hint").notNull(),
    amount: integer("amount").notNull(),
    batchId: text("batch_id").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    redeemedByUserId: text("redeemed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    redeemedAt: integer("redeemed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("point_redemption_code_hash_unique").on(table.codeHash),
    index("point_redemption_code_batch_idx").on(table.batchId, table.createdAt),
    index("point_redemption_code_redeemed_idx").on(
      table.redeemedByUserId,
      table.redeemedAt,
    ),
    check("point_redemption_code_amount_positive", sql`${table.amount} > 0`),
  ],
);

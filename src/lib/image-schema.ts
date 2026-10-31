import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";

export const imageSetting = sqliteTable("image_setting", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).default(false).notNull(),
  pointValueCents: integer("point_value_cents").default(1).notNull(),
  standardPoints: integer("standard_points").default(24).notNull(),
  hdPoints: integer("hd_points").default(36).notNull(),
  dailyJobLimit: integer("daily_job_limit").default(100).notNull(),
  monthlyBudgetCents: integer("monthly_budget_cents")
    .default(5000)
    .notNull(),
  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const imageProvider = sqliteTable(
  "image_provider",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    adapter: text("adapter").notNull(),
    model: text("model").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    priority: integer("priority").default(100).notNull(),
    dailyJobLimit: integer("daily_job_limit").default(100).notNull(),
    monthlyBudgetCents: integer("monthly_budget_cents")
      .default(5000)
      .notNull(),
    reserveCostCents: integer("reserve_cost_cents").default(12).notNull(),
    actualCostCents: integer("actual_cost_cents").default(10).notNull(),
    allowPaidOverage: integer("allow_paid_overage", { mode: "boolean" })
      .default(false)
      .notNull(),
    failureThreshold: integer("failure_threshold").default(3).notNull(),
    cooldownSeconds: integer("cooldown_seconds").default(600).notNull(),
    consecutiveFailures: integer("consecutive_failures")
      .default(0)
      .notNull(),
    cooldownUntil: integer("cooldown_until", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("image_provider_priority_nonnegative", sql`${table.priority} >= 0`),
    check(
      "image_provider_daily_limit_nonnegative",
      sql`${table.dailyJobLimit} >= 0`,
    ),
    index("image_provider_enabled_priority_idx").on(
      table.enabled,
      table.priority,
    ),
  ],
);

export const imageConfigAudit = sqliteTable(
  "image_config_audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    configType: text("config_type").notNull(),
    configId: text("config_id").notNull(),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("image_config_audit_created_idx").on(table.createdAt),
    index("image_config_audit_target_idx").on(
      table.configType,
      table.configId,
      table.createdAt,
    ),
  ],
);

export const imageProviderUsage = sqliteTable(
  "image_provider_usage",
  {
    providerId: text("provider_id")
      .notNull()
      .references(() => imageProvider.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    jobs: integer("jobs").default(0).notNull(),
    successes: integer("successes").default(0).notNull(),
    failures: integer("failures").default(0).notNull(),
    reservedCents: integer("reserved_cents").default(0).notNull(),
    spentCents: integer("spent_cents").default(0).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.providerId, table.period],
    }),
  ],
);

export const imageJob = sqliteTable(
  "image_job",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    sourceId: text("source_id"),
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt").default("").notNull(),
    quality: text("quality").default("standard").notNull(),
    aspectRatio: text("aspect_ratio").default("1:1").notNull(),
    pointsCost: integer("points_cost").notNull(),
    balanceAfter: integer("balance_after"),
    status: text("status").default("pending").notNull(),
    providerId: text("provider_id").references(() => imageProvider.id, {
      onDelete: "set null",
    }),
    model: text("model"),
    permission: text("permission").default("private").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("image_job_user_request_unique").on(
      table.userId,
      table.requestId,
    ),
    index("image_job_user_created_idx").on(table.userId, table.createdAt),
    index("image_job_status_created_idx").on(table.status, table.createdAt),
    index("image_job_source_idx").on(
      table.feature,
      table.sourceId,
    ),
    uniqueIndex("image_job_active_source_unique")
      .on(table.userId, table.feature, table.sourceId)
      .where(
        sql`${table.sourceId} IS NOT NULL AND ${table.status} IN ('pending', 'processing', 'succeeded')`,
      ),
    check(
      "image_job_status_valid",
      sql`${table.status} in ('pending', 'processing', 'succeeded', 'failed')`,
    ),
    check(
      "image_job_quality_valid",
      sql`${table.quality} in ('standard', 'hd')`,
    ),
  ],
);

export const imageAsset = sqliteTable(
  "image_asset",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .unique()
      .references(() => imageJob.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => imageProvider.id, { onDelete: "restrict" }),
    model: text("model").notNull(),
    r2Key: text("r2_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    prompt: text("prompt").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("image_asset_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const imageAttempt = sqliteTable(
  "image_attempt",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => imageJob.id, { onDelete: "cascade" }),
    providerId: text("provider_id")
      .notNull()
      .references(() => imageProvider.id, { onDelete: "restrict" }),
    model: text("model").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("image_attempt_job_created_idx").on(
      table.jobId,
      table.createdAt,
    ),
    index("image_attempt_provider_created_idx").on(
      table.providerId,
      table.createdAt,
    ),
    check(
      "image_attempt_status_valid",
      sql`${table.status} in ('succeeded', 'failed')`,
    ),
  ],
);

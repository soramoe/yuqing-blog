import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export const storySetting = sqliteTable("story_setting", {
  id: text("id").primaryKey(),
  pointsPerTurn: integer("points_per_turn").default(4).notNull(),
  maxOutputTokens: integer("max_output_tokens").default(1000).notNull(),
  contextTurns: integer("context_turns").default(4).notNull(),
  dailyTurnLimit: integer("daily_turn_limit").default(30).notNull(),
  trialEnabled: integer("trial_enabled", { mode: "boolean" })
    .default(true)
    .notNull(),
  trialGithubTurns: integer("trial_github_turns").default(2).notNull(),
  trialEmailTurns: integer("trial_email_turns").default(1).notNull(),
  trialMaxOutputTokens: integer("trial_max_output_tokens")
    .default(600)
    .notNull(),
  trialDailyBudgetYuan: integer("trial_daily_budget_yuan")
    .default(5)
    .notNull(),
  trialIpDailyLimit: integer("trial_ip_daily_limit").default(2).notNull(),
  siteKeyEnabled: integer("site_key_enabled", { mode: "boolean" })
    .default(true)
    .notNull(),
  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const storySettingAudit = sqliteTable(
  "story_setting_audit",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("story_setting_audit_created_idx").on(table.createdAt),
  ],
);

export interface StorySettings {
  pointsPerTurn: number;
  maxOutputTokens: number;
  contextTurns: number;
  dailyTurnLimit: number;
  trialEnabled: boolean;
  trialGithubTurns: number;
  trialEmailTurns: number;
  trialMaxOutputTokens: number;
  trialDailyBudgetYuan: number;
  trialIpDailyLimit: number;
  siteKeyEnabled: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  pointsPerTurn: 4,
  maxOutputTokens: 1000,
  contextTurns: 4,
  dailyTurnLimit: 30,
  trialEnabled: true,
  trialGithubTurns: 2,
  trialEmailTurns: 1,
  trialMaxOutputTokens: 600,
  trialDailyBudgetYuan: 5,
  trialIpDailyLimit: 2,
  siteKeyEnabled: true,
  updatedAt: null,
  updatedBy: null,
};

export function sanitizeStorySettings(value: unknown): StorySettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const integer = (
    key: keyof StorySettings,
    minimum: number,
    maximum: number,
    fallback: number,
  ) => {
    const parsed = Number(input[key]);
    return Number.isInteger(parsed)
      ? Math.min(maximum, Math.max(minimum, parsed))
      : fallback;
  };

  return {
    pointsPerTurn: integer("pointsPerTurn", 1, 20, 4),
    maxOutputTokens: integer("maxOutputTokens", 300, 4000, 1000),
    contextTurns: integer("contextTurns", 1, 12, 4),
    dailyTurnLimit: integer("dailyTurnLimit", 1, 500, 30),
    trialEnabled:
      typeof input.trialEnabled === "boolean" ? input.trialEnabled : true,
    trialGithubTurns: integer("trialGithubTurns", 0, 10, 2),
    trialEmailTurns: integer("trialEmailTurns", 0, 10, 1),
    trialMaxOutputTokens: integer("trialMaxOutputTokens", 300, 1200, 600),
    trialDailyBudgetYuan: integer("trialDailyBudgetYuan", 0, 100, 5),
    trialIpDailyLimit: integer("trialIpDailyLimit", 1, 10, 2),
    siteKeyEnabled:
      typeof input.siteKeyEnabled === "boolean"
        ? input.siteKeyEnabled
        : true,
    updatedAt: null,
    updatedBy: null,
  };
}

export async function getStorySettings(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT
        points_per_turn AS pointsPerTurn,
        max_output_tokens AS maxOutputTokens,
        context_turns AS contextTurns,
        daily_turn_limit AS dailyTurnLimit,
        trial_enabled AS trialEnabled,
        trial_github_turns AS trialGithubTurns,
        trial_email_turns AS trialEmailTurns,
        trial_max_output_tokens AS trialMaxOutputTokens,
        trial_daily_budget_yuan AS trialDailyBudgetYuan,
        trial_ip_daily_limit AS trialIpDailyLimit,
        site_key_enabled AS siteKeyEnabled,
        updated_at AS updatedAt,
        updated_by AS updatedBy
       FROM story_setting
       WHERE id = 'global'`,
    )
    .first<{
      pointsPerTurn: number;
      maxOutputTokens: number;
      contextTurns: number;
      dailyTurnLimit: number;
      trialEnabled: number;
      trialGithubTurns: number;
      trialEmailTurns: number;
      trialMaxOutputTokens: number;
      trialDailyBudgetYuan: number;
      trialIpDailyLimit: number;
      siteKeyEnabled: number;
      updatedAt: number | null;
      updatedBy: string | null;
    }>();

  if (!row) return { ...DEFAULT_STORY_SETTINGS };
  return {
    pointsPerTurn: Number(row.pointsPerTurn),
    maxOutputTokens: Number(row.maxOutputTokens),
    contextTurns: Number(row.contextTurns),
    dailyTurnLimit: Number(row.dailyTurnLimit),
    trialEnabled: Boolean(row.trialEnabled),
    trialGithubTurns: Number(row.trialGithubTurns),
    trialEmailTurns: Number(row.trialEmailTurns),
    trialMaxOutputTokens: Number(row.trialMaxOutputTokens),
    trialDailyBudgetYuan: Number(row.trialDailyBudgetYuan),
    trialIpDailyLimit: Number(row.trialIpDailyLimit),
    siteKeyEnabled: Boolean(row.siteKeyEnabled),
    updatedAt: row.updatedAt ? Number(row.updatedAt) : null,
    updatedBy: row.updatedBy,
  } satisfies StorySettings;
}

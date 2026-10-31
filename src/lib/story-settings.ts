export interface StorySettings {
  pointsPerTurn: number;
  maxOutputTokens: number;
  contextTurns: number;
  dailyTurnLimit: number;
  siteKeyEnabled: boolean;
  updatedAt: number | null;
  updatedBy: string | null;
}

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  pointsPerTurn: 4,
  maxOutputTokens: 1000,
  contextTurns: 4,
  dailyTurnLimit: 30,
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
    siteKeyEnabled: Boolean(row.siteKeyEnabled),
    updatedAt: row.updatedAt ? Number(row.updatedAt) : null,
    updatedBy: row.updatedBy,
  } satisfies StorySettings;
}

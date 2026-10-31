export const IMAGE_POINT_VALUE_CENTS = 1;
export const IMAGE_STANDARD_POINTS = 24;
export const IMAGE_HD_POINTS = 36;

export type ImageQuality = "standard" | "hd";
export type ImageFeature = "story_chapter" | "image_studio" | "admin_test";
export type ImagePermission = "private" | "public";
export type ImageProviderAdapter = "workers-ai" | "dashscope-images";

export interface ImageSettings {
  enabled: boolean;
  pointValueCents: number;
  standardPoints: number;
  hdPoints: number;
  dailyJobLimit: number;
  monthlyBudgetCents: number;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface ImageProviderConfig {
  id: string;
  name: string;
  adapter: ImageProviderAdapter;
  model: string;
  enabled: boolean;
  priority: number;
  dailyJobLimit: number;
  monthlyBudgetCents: number;
  reserveCostCents: number;
  actualCostCents: number;
  allowPaidOverage: boolean;
  failureThreshold: number;
  cooldownSeconds: number;
  consecutiveFailures: number;
  cooldownUntil: number | null;
  updatedAt: number;
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  enabled: false,
  pointValueCents: IMAGE_POINT_VALUE_CENTS,
  standardPoints: IMAGE_STANDARD_POINTS,
  hdPoints: IMAGE_HD_POINTS,
  dailyJobLimit: 100,
  monthlyBudgetCents: 5000,
  updatedAt: null,
  updatedBy: null,
};

const clampInteger = (
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) => {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
};

export function sanitizeImageSettings(value: unknown): ImageSettings {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : false,
    pointValueCents: clampInteger(
      input.pointValueCents,
      1,
      100,
      IMAGE_POINT_VALUE_CENTS,
    ),
    standardPoints: clampInteger(
      input.standardPoints,
      1,
      1000,
      IMAGE_STANDARD_POINTS,
    ),
    hdPoints: clampInteger(
      input.hdPoints,
      1,
      1000,
      IMAGE_HD_POINTS,
    ),
    dailyJobLimit: clampInteger(input.dailyJobLimit, 1, 5000, 100),
    monthlyBudgetCents: clampInteger(
      input.monthlyBudgetCents,
      0,
      1_000_000,
      5000,
    ),
    updatedAt: null,
    updatedBy: null,
  };
}

export async function getImageSettings(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT
        enabled,
        point_value_cents AS pointValueCents,
        standard_points AS standardPoints,
        hd_points AS hdPoints,
        daily_job_limit AS dailyJobLimit,
        monthly_budget_cents AS monthlyBudgetCents,
        updated_at AS updatedAt,
        updated_by AS updatedBy
       FROM image_setting
       WHERE id = 'global'`,
    )
    .first<{
      enabled: number;
      pointValueCents: number;
      standardPoints: number;
      hdPoints: number;
      dailyJobLimit: number;
      monthlyBudgetCents: number;
      updatedAt: number;
      updatedBy: string | null;
    }>();
  if (!row) return { ...DEFAULT_IMAGE_SETTINGS };
  return {
    enabled: Boolean(row.enabled),
    pointValueCents: Number(row.pointValueCents),
    standardPoints: Number(row.standardPoints),
    hdPoints: Number(row.hdPoints),
    dailyJobLimit: Number(row.dailyJobLimit),
    monthlyBudgetCents: Number(row.monthlyBudgetCents),
    updatedAt: Number(row.updatedAt),
    updatedBy: row.updatedBy,
  } satisfies ImageSettings;
}

export async function listImageProviders(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT
        id,
        name,
        adapter,
        model,
        enabled,
        priority,
        daily_job_limit AS dailyJobLimit,
        monthly_budget_cents AS monthlyBudgetCents,
        reserve_cost_cents AS reserveCostCents,
        actual_cost_cents AS actualCostCents,
        allow_paid_overage AS allowPaidOverage,
        failure_threshold AS failureThreshold,
        cooldown_seconds AS cooldownSeconds,
        consecutive_failures AS consecutiveFailures,
        cooldown_until AS cooldownUntil,
        updated_at AS updatedAt
       FROM image_provider
       ORDER BY priority ASC, id ASC`,
    )
    .all<{
      id: string;
      name: string;
      adapter: string;
      model: string;
      enabled: number;
      priority: number;
      dailyJobLimit: number;
      monthlyBudgetCents: number;
      reserveCostCents: number;
      actualCostCents: number;
      allowPaidOverage: number;
      failureThreshold: number;
      cooldownSeconds: number;
      consecutiveFailures: number;
      cooldownUntil: number | null;
      updatedAt: number;
    }>();
  return result.results.map(
    (row): ImageProviderConfig => ({
      id: row.id,
      name: row.name,
      adapter:
        row.adapter === "workers-ai" ? "workers-ai" : "dashscope-images",
      model: row.model,
      enabled: Boolean(row.enabled),
      priority: Number(row.priority),
      dailyJobLimit: Number(row.dailyJobLimit),
      monthlyBudgetCents: Number(row.monthlyBudgetCents),
      reserveCostCents: Number(row.reserveCostCents),
      actualCostCents: Number(row.actualCostCents),
      allowPaidOverage: Boolean(row.allowPaidOverage),
      failureThreshold: Number(row.failureThreshold),
      cooldownSeconds: Number(row.cooldownSeconds),
      consecutiveFailures: Number(row.consecutiveFailures),
      cooldownUntil: row.cooldownUntil ? Number(row.cooldownUntil) : null,
      updatedAt: Number(row.updatedAt),
    }),
  );
}

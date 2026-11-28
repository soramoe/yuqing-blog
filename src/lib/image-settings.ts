export const IMAGE_POINT_VALUE_CENTS = 1;
export const IMAGE_STANDARD_POINTS = 20;
export const IMAGE_HD_POINTS = 32;
export const IMAGE_STUDIO_POINTS = 40;
export const IMAGE_QUEUE_JUMP_POINTS = 60;

export type ImageQuality = "standard" | "hd";
export type ImageFeature = "story_chapter" | "image_studio" | "admin_test";
export type ImagePermission = "private" | "public";
export type ImageProviderAdapter =
  | "workers-ai"
  | "dashscope-images"
  | "openai-images"
  | "colab-sdxl"
  | "ark-images"
  | "bigmodel-image";

// 读取 provider 时只做校验、不做改写：未知的适配器保持原样（不会被路由），
// 绝不能回落成某个真实适配器，否则请求会被发到别家服务商。
const toAdapter = (value: string | null | undefined): ImageProviderAdapter => {
  const normalized = value?.trim() ?? "";
  // 历史数据：适配器列为空时按最早接入的千问处理
  return (normalized || "dashscope-images") as ImageProviderAdapter;
};

export interface ImageSettings {
  enabled: boolean;
  /** 互动小说章节插画独立开关：总开关关闭时仍然整体不开放 */
  storyEnabled: boolean;
  pointValueCents: number;
  standardPoints: number;
  hdPoints: number;
  studioPoints: number;
  queueJumpPoints: number;
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
  /** 逗号分隔的功能白名单；为空表示对所有生图功能可用 */
  features: string;
  /** 供应商绑定的 API 密钥（后台可改；留空回退环境变量） */
  apiKey: string;
  /** 供应商自定义接入地址（留空回退默认值） */
  baseUrl: string;
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
  storyEnabled: true,
  pointValueCents: IMAGE_POINT_VALUE_CENTS,
  standardPoints: IMAGE_STANDARD_POINTS,
  hdPoints: IMAGE_HD_POINTS,
  studioPoints: IMAGE_STUDIO_POINTS,
  queueJumpPoints: IMAGE_QUEUE_JUMP_POINTS,
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
    // 旧客户端不传该字段时保持开启，避免一次普通保存把小说插画关掉
    storyEnabled:
      typeof input.storyEnabled === "boolean" ? input.storyEnabled : true,
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
    studioPoints: clampInteger(
      input.studioPoints,
      1,
      10000,
      IMAGE_STUDIO_POINTS,
    ),
    queueJumpPoints: clampInteger(
      input.queueJumpPoints,
      0,
      10000,
      IMAGE_QUEUE_JUMP_POINTS,
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
        story_enabled AS storyEnabled,
        point_value_cents AS pointValueCents,
        standard_points AS standardPoints,
        hd_points AS hdPoints,
        studio_points AS studioPoints,
        queue_jump_points AS queueJumpPoints,
        daily_job_limit AS dailyJobLimit,
        monthly_budget_cents AS monthlyBudgetCents,
        updated_at AS updatedAt,
        updated_by AS updatedBy
       FROM image_setting
       WHERE id = 'global'`,
    )
    .first<{
      enabled: number;
      storyEnabled: number;
      pointValueCents: number;
      standardPoints: number;
      hdPoints: number;
      studioPoints: number;
      queueJumpPoints: number;
      dailyJobLimit: number;
      monthlyBudgetCents: number;
      updatedAt: number;
      updatedBy: string | null;
    }>();
  if (!row) return { ...DEFAULT_IMAGE_SETTINGS };
  return {
    enabled: Boolean(row.enabled),
    storyEnabled: Boolean(row.storyEnabled),
    pointValueCents: Number(row.pointValueCents),
    standardPoints: Number(row.standardPoints),
    hdPoints: Number(row.hdPoints),
    studioPoints: Number(row.studioPoints),
    queueJumpPoints: Number(row.queueJumpPoints),
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
        features,
        api_key AS apiKey,
        base_url AS baseUrl,
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
      features: string;
      apiKey: string;
      baseUrl: string;
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
      adapter: toAdapter(row.adapter),
      model: row.model,
      features: row.features ?? "",
      apiKey: row.apiKey ?? "",
      baseUrl: row.baseUrl ?? "",
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

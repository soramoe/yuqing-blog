import { chinaDateKey } from "./points";
import {
  getImageSettings,
  listImageProviders,
  type ImageProviderConfig,
  type ImageSettings,
} from "./image-settings";
import {
  generateWithProvider,
  ImageProviderError,
  isProviderConfigured,
  type ImageGenerationRequest,
  type ImageProviderEnv,
} from "./image-providers";

export interface ImageRouterEnv extends ImageProviderEnv {
  DB: D1Database;
}

export interface ImageRoutingResult {
  bytes: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  providerId: string;
  providerName: string;
  model: string;
  attempts: number;
}

export class ImageRoutingError extends Error {
  constructor(
    message: string,
    readonly attemptedProviders: number,
  ) {
    super(message);
    this.name = "ImageRoutingError";
  }
}

const monthKey = () => chinaDateKey().slice(0, 7);
const budgetReserveCents = (provider: ImageProviderConfig) =>
  Math.max(0, provider.reserveCostCents, provider.actualCostCents);

const quotaCondition = (provider: ImageProviderConfig) =>
  provider.allowPaidOverage
    ? "1 = 1"
    : `image_provider_usage.reserved_cents +
       image_provider_usage.spent_cents +
       excluded.reserved_cents <= ${Math.max(0, provider.monthlyBudgetCents)}`;

async function reserveProviderAttempt(
  db: D1Database,
  provider: ImageProviderConfig,
  now: number,
) {
  const daily = await db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM image_attempt
       WHERE provider_id = ?
         AND date(created_at / 1000, 'unixepoch', '+8 hours') = ?`,
    )
    .bind(provider.id, chinaDateKey())
    .first<{ total: number }>();
  if (Number(daily?.total ?? 0) >= provider.dailyJobLimit) {
    return false;
  }

  const period = monthKey();
  const reserveCents = budgetReserveCents(provider);
  if (
    reserveCents > 0 &&
    !provider.allowPaidOverage &&
    reserveCents > provider.monthlyBudgetCents
  ) {
    return false;
  }
  if (reserveCents === 0) {
    await db
      .prepare(
        `INSERT INTO image_provider_usage
          (provider_id, period, jobs, successes, failures,
           reserved_cents, spent_cents, updated_at)
         VALUES (?, ?, 1, 0, 0, 0, 0, ?)
         ON CONFLICT(provider_id, period) DO UPDATE SET
           jobs = image_provider_usage.jobs + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(provider.id, period, now)
      .run();
    return true;
  }

  const statement = db
    .prepare(
      `INSERT INTO image_provider_usage
        (provider_id, period, jobs, successes, failures,
         reserved_cents, spent_cents, updated_at)
       VALUES (?, ?, 1, 0, 0, ?, 0, ?)
       ON CONFLICT(provider_id, period) DO UPDATE SET
         jobs = image_provider_usage.jobs + 1,
         reserved_cents =
           image_provider_usage.reserved_cents + excluded.reserved_cents,
         updated_at = excluded.updated_at
       WHERE ${quotaCondition(provider)}
       RETURNING reserved_cents AS reservedCents`,
    )
    .bind(
      provider.id,
      period,
      reserveCents,
      now,
    );
  return Boolean(await statement.first());
}

async function settleProviderAttempt(
  db: D1Database,
  provider: ImageProviderConfig,
  succeeded: boolean,
  now: number,
) {
  const reserveCents = budgetReserveCents(provider);
  // Conservatively count failed paid calls too: a timeout can happen after the
  // provider has already accepted the billable request.
  const actualCents = Math.max(0, provider.actualCostCents);
  await db
    .prepare(
      `UPDATE image_provider_usage
       SET reserved_cents = MAX(0, reserved_cents - ?),
           spent_cents = spent_cents + ?,
           successes = successes + ?,
           failures = failures + ?,
           updated_at = ?
       WHERE provider_id = ? AND period = ?`,
    )
    .bind(
      reserveCents,
      actualCents,
      succeeded ? 1 : 0,
      succeeded ? 0 : 1,
      now,
      provider.id,
      monthKey(),
    )
    .run();
}

async function recordAttempt(
  db: D1Database,
  input: {
    jobId: string;
    provider: ImageProviderConfig;
    succeeded: boolean;
    startedAt: number;
    error?: unknown;
  },
) {
  const now = Date.now();
  const providerError =
    input.error instanceof ImageProviderError ? input.error : null;
  await db
    .prepare(
      `INSERT INTO image_attempt
        (id, job_id, provider_id, model, status, error_code,
         error_message, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.jobId,
      input.provider.id,
      input.provider.model,
      input.succeeded ? "succeeded" : "failed",
      input.succeeded ? null : providerError?.code ?? "provider-error",
      input.succeeded
        ? null
        : providerError?.message.slice(0, 500) ??
          "图片供应商调用失败。",
      Math.max(0, Date.now() - input.startedAt),
      now,
    )
    .run();
}

async function updateProviderHealth(
  db: D1Database,
  provider: ImageProviderConfig,
  succeeded: boolean,
  now: number,
) {
  if (succeeded) {
    await db
      .prepare(
        `UPDATE image_provider
         SET consecutive_failures = 0, cooldown_until = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, provider.id)
      .run();
    return;
  }

  const failures = provider.consecutiveFailures + 1;
  const cooldownUntil =
    failures >= provider.failureThreshold
      ? now + provider.cooldownSeconds * 1000
      : null;
  await db
    .prepare(
      `UPDATE image_provider
       SET consecutive_failures = ?, cooldown_until = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(failures, cooldownUntil, now, provider.id)
    .run();
}

async function assertGlobalBudget(
  db: D1Database,
  settings: ImageSettings,
  reserveCents: number,
) {
  if (reserveCents <= 0 || settings.monthlyBudgetCents <= 0) return;
  const used = await db
    .prepare(
      `SELECT COALESCE(SUM(reserved_cents + spent_cents), 0) AS total
       FROM image_provider_usage
       WHERE period = ?`,
    )
    .bind(monthKey())
    .first<{ total: number }>();
  if (Number(used?.total ?? 0) + reserveCents > settings.monthlyBudgetCents) {
    throw new ImageRoutingError("本月全站生图预算已经用完。", 0);
  }
}

export async function routeImageGeneration(
  env: ImageRouterEnv,
  jobId: string,
  request: ImageGenerationRequest,
): Promise<ImageRoutingResult> {
  const [settings, providers] = await Promise.all([
    getImageSettings(env.DB),
    listImageProviders(env.DB),
  ]);
  if (!settings.enabled) {
    throw new ImageRoutingError("生图功能当前未开放。", 0);
  }

  const now = Date.now();
  let attempted = 0;
  const errors: string[] = [];
  for (const provider of providers) {
    if (!provider.enabled) continue;
    if (provider.cooldownUntil && provider.cooldownUntil > now) continue;
    if (!isProviderConfigured(env, provider)) continue;

    await assertGlobalBudget(env.DB, settings, budgetReserveCents(provider));
    const reserved = await reserveProviderAttempt(env.DB, provider, now);
    if (!reserved) {
      errors.push(`${provider.name} 已达到今日额度或本月预算。`);
      continue;
    }

    attempted += 1;
    const startedAt = Date.now();
    try {
      const result = await generateWithProvider(env, provider, request);
      await settleProviderAttempt(env.DB, provider, true, Date.now());
      await recordAttempt(env.DB, {
        jobId,
        provider,
        succeeded: true,
        startedAt,
      });
      await updateProviderHealth(env.DB, provider, true, Date.now());
      return {
        ...result,
        providerId: provider.id,
        providerName: provider.name,
        model: provider.model,
        attempts: attempted,
      };
    } catch (error) {
      await settleProviderAttempt(env.DB, provider, false, Date.now());
      await recordAttempt(env.DB, {
        jobId,
        provider,
        succeeded: false,
        startedAt,
        error,
      });
      await updateProviderHealth(env.DB, provider, false, Date.now());
      errors.push(
        error instanceof Error ? error.message : `${provider.name} 调用失败。`,
      );
    }
  }

  throw new ImageRoutingError(
    errors.length > 0
      ? `所有图片模型均不可用：${errors.join("；")}`
      : "没有可用的图片模型。",
    attempted,
  );
}

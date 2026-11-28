import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import { chinaDateKey } from "../../../../src/lib/points";
import {
  getImageSettings,
  listImageProviders,
  sanitizeImageSettings,
  type ImageProviderConfig,
} from "../../../../src/lib/image-settings";
import { isProviderConfigured } from "../../../../src/lib/image-providers";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

const authorize = async (request: Request, env: Env) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return { response: json({ error: "请求来源不受信任。" }, 403) };
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { response: json({ error: "请先登录。" }, 401) };
  }
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return { response: json({ error: "你没有生图管理权限。" }, 403) };
  }
  return { session };
};

const maskKey = (value: string) =>
  value ? `${value.slice(0, 4)}***（${value.length} 字符）` : "";

const providerStatus = (
  env: Env,
  provider: ImageProviderConfig,
) => {
  const { apiKey, ...rest } = provider;
  return {
    ...rest,
    configured: isProviderConfigured(env, provider),
    cooldownActive: Boolean(
      provider.cooldownUntil && provider.cooldownUntil > Date.now(),
    ),
    hasApiKey: Boolean(apiKey?.trim()),
    apiKeyMasked: maskKey(apiKey ?? ""),
  };
};

const listUsage = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT
        provider_id AS providerId,
        period,
        jobs,
        successes,
        failures,
        reserved_cents AS reservedCents,
        spent_cents AS spentCents,
        updated_at AS updatedAt
       FROM image_provider_usage
       ORDER BY period DESC, provider_id ASC
       LIMIT 30`,
    )
    .all();
  return result.results.map((row) => ({
    ...row,
    jobs: Number(row.jobs),
    successes: Number(row.successes),
    failures: Number(row.failures),
    reservedCents: Number(row.reservedCents),
    spentCents: Number(row.spentCents),
    updatedAt: Number(row.updatedAt),
  }));
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;
  const [settings, providers, usage, todayStats, recentAttempts] = await Promise.all([
    getImageSettings(env.DB),
    listImageProviders(env.DB),
    listUsage(env.DB),
    (async () => {
      const today = chinaDateKey();
      const jobs = await env.DB.prepare(
        `SELECT
           COUNT(*) AS jobs,
           SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM image_job
         WHERE date(created_at / 1000, 'unixepoch', '+8 hours') = ?`,
      )
        .bind(today)
        .first();
      const attempts = await env.DB.prepare(
        `SELECT provider_id AS providerId,
           COUNT(*) AS attempts,
           SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM image_attempt
         WHERE date(created_at / 1000, 'unixepoch', '+8 hours') = ?
         GROUP BY provider_id`,
      )
        .bind(today)
        .all();
      return {
        jobs: Number(jobs?.jobs ?? 0),
        succeeded: Number(jobs?.succeeded ?? 0),
        failed: Number(jobs?.failed ?? 0),
        byProvider: attempts.results.map((row) => ({
          ...row,
          attempts: Number(row.attempts),
          succeeded: Number(row.succeeded),
          failed: Number(row.failed),
        })),
      };
    })(),
    (async () => {
      const rows = await env.DB.prepare(
        `SELECT a.provider_id AS providerId, p.name AS providerName,
           a.model, a.status, a.error_code AS errorCode,
           substr(a.error_message, 1, 120) AS errorMessage,
           a.duration_ms AS durationMs, a.created_at AS createdAt
         FROM image_attempt a
         LEFT JOIN image_provider p ON p.id = a.provider_id
         ORDER BY a.created_at DESC
         LIMIT 12`,
      ).all();
      return rows.results.map((row) => ({
        ...row,
        durationMs: Number(row.durationMs),
        createdAt: Number(row.createdAt),
      }));
    })(),
  ]);
  return json({
    settings,
    providers: providers.map((provider) => providerStatus(env, provider)),
    usage,
    today: todayStats,
    recentAttempts,
  });
};

const integer = (
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

export const onRequestPatch: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "生图设置格式无效。" }, 400);
  }
  const input =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const beforeSettings = await getImageSettings(env.DB);
  const beforeProviders = await listImageProviders(env.DB);
  const nextSettings = sanitizeImageSettings(input.settings);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO image_setting
        (id, enabled, point_value_cents, standard_points, hd_points,
         studio_points, queue_jump_points, daily_job_limit,
         monthly_budget_cents, updated_by, updated_at)
       VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         enabled = excluded.enabled,
         point_value_cents = excluded.point_value_cents,
         standard_points = excluded.standard_points,
         hd_points = excluded.hd_points,
         studio_points = excluded.studio_points,
         queue_jump_points = excluded.queue_jump_points,
         daily_job_limit = excluded.daily_job_limit,
         monthly_budget_cents = excluded.monthly_budget_cents,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    ).bind(
      nextSettings.enabled ? 1 : 0,
      nextSettings.pointValueCents,
      nextSettings.standardPoints,
      nextSettings.hdPoints,
      nextSettings.studioPoints,
      nextSettings.queueJumpPoints,
      nextSettings.dailyJobLimit,
      nextSettings.monthlyBudgetCents,
      authorized.session.user.id,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO image_config_audit
        (id, user_id, config_type, config_id, before_json,
         after_json, created_at)
       VALUES (?, ?, 'settings', 'global', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      authorized.session.user.id,
      JSON.stringify(beforeSettings),
      JSON.stringify(nextSettings),
      now,
    ),
  ];

  const providerInputs = Array.isArray(input.providers)
    ? input.providers
    : [];
  for (const rawProvider of providerInputs) {
    if (!rawProvider || typeof rawProvider !== "object") continue;
    const incoming = rawProvider as Record<string, unknown>;
    const id = typeof incoming.id === "string" ? incoming.id : "";
    const before = beforeProviders.find((provider) => provider.id === id);
    if (!before) continue;
    const next = {
      name:
        typeof incoming.name === "string"
          ? incoming.name.trim().slice(0, 60)
          : before.name,
      model:
        typeof incoming.model === "string"
          ? incoming.model.trim().slice(0, 120)
          : before.model,
      enabled:
        typeof incoming.enabled === "boolean"
          ? incoming.enabled
          : before.enabled,
      priority: integer(incoming.priority, 0, 10000, before.priority),
      dailyJobLimit: integer(
        incoming.dailyJobLimit,
        0,
        100000,
        before.dailyJobLimit,
      ),
      monthlyBudgetCents: integer(
        incoming.monthlyBudgetCents,
        0,
        100_000_000,
        before.monthlyBudgetCents,
      ),
      reserveCostCents: integer(
        incoming.reserveCostCents,
        0,
        100_000,
        before.reserveCostCents,
      ),
      actualCostCents: integer(
        incoming.actualCostCents,
        0,
        100_000,
        before.actualCostCents,
      ),
      allowPaidOverage:
        typeof incoming.allowPaidOverage === "boolean"
          ? incoming.allowPaidOverage
          : before.allowPaidOverage,
      failureThreshold: integer(
        incoming.failureThreshold,
        1,
        100,
        before.failureThreshold,
      ),
      cooldownSeconds: integer(
        incoming.cooldownSeconds,
        0,
        86400,
        before.cooldownSeconds,
      ),
      // 绑定信息：留空 = 保持当前绑定不变
      apiKey:
        typeof incoming.apiKey === "string" && incoming.apiKey.trim()
          ? incoming.apiKey.trim().slice(0, 300)
          : before.apiKey,
      baseUrl:
        typeof incoming.baseUrl === "string" && incoming.baseUrl.trim()
          ? incoming.baseUrl.trim().slice(0, 300)
          : before.baseUrl,
    };
    statements.push(
      env.DB.prepare(
        `UPDATE image_provider
         SET name = ?, model = ?, enabled = ?, priority = ?,
             daily_job_limit = ?, monthly_budget_cents = ?,
             reserve_cost_cents = ?, actual_cost_cents = ?,
             allow_paid_overage = ?, failure_threshold = ?,
             cooldown_seconds = ?, api_key = ?, base_url = ?,
             updated_at = ?
         WHERE id = ?`,
      ).bind(
        next.name || before.name,
        next.model || before.model,
        next.enabled ? 1 : 0,
        next.priority,
        next.dailyJobLimit,
        next.monthlyBudgetCents,
        next.reserveCostCents,
        next.actualCostCents,
        next.allowPaidOverage ? 1 : 0,
        next.failureThreshold,
        next.cooldownSeconds,
        next.apiKey || before.apiKey,
        next.baseUrl || before.baseUrl,
        now,
        id,
      ),
      env.DB.prepare(
        `INSERT INTO image_config_audit
          (id, user_id, config_type, config_id, before_json,
           after_json, created_at)
         VALUES (?, ?, 'provider', ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        authorized.session.user.id,
        id,
        JSON.stringify(before),
        JSON.stringify({ ...before, ...next }),
        now,
      ),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch {
    return json({ error: "生图设置保存失败，请稍后重试。" }, 500);
  }
  const [settings, providers, usage] = await Promise.all([
    getImageSettings(env.DB),
    listImageProviders(env.DB),
    listUsage(env.DB),
  ]);
  return json({
    ok: true,
    settings,
    providers: providers.map((provider) => providerStatus(env, provider)),
    usage,
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "GET, PATCH" },
  });
};

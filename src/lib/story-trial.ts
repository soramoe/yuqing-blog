import type { StorySettings } from "./story-settings";

export interface StoryTrialStatus {
  enabled: boolean;
  available: boolean;
  provider: "github" | "email";
  freeTurnsTotal: number;
  freeTurnsUsed: number;
  freeTurnsRemaining: number;
  boundSessionId: string | null;
}

interface TrialClaimRow {
  sessionId: string;
  provider: string;
  freeTurnsTotal: number;
  freeTurnsUsed: number;
}

export interface TrialReservation {
  day: string;
  ipHash: string;
  reservedCents: number;
  createdClaim: boolean;
}

export class StoryTrialError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | "trial-disabled"
      | "trial-used"
      | "trial-bound"
      | "trial-ip-limit"
      | "trial-budget"
      | "trial-race",
  ) {
    super(message);
    this.name = "StoryTrialError";
  }
}

const normalizeProvider = (value: unknown): "github" | "email" =>
  value === "github" ? "github" : "email";

const trialLimitForProvider = (
  provider: "github" | "email",
  settings: StorySettings,
) =>
  Math.max(
    0,
    provider === "github"
      ? settings.trialGithubTurns
      : settings.trialEmailTurns,
  );

export async function getStoryTrialProvider(
  db: D1Database,
  userId: string,
) {
  const row = await db
    .prepare(
      `SELECT provider_id AS providerId
       FROM account
       WHERE user_id = ?
       ORDER BY CASE WHEN provider_id = 'github' THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ providerId: string }>();
  return normalizeProvider(row?.providerId);
}

export async function getStoryTrialStatus(
  db: D1Database,
  userId: string,
  settings: StorySettings,
): Promise<StoryTrialStatus> {
  const provider = await getStoryTrialProvider(db, userId);
  const requestedTotal = trialLimitForProvider(provider, settings);
  const claim = await db
    .prepare(
      `SELECT
        session_id AS sessionId,
        provider,
        free_turns_total AS freeTurnsTotal,
        free_turns_used AS freeTurnsUsed
       FROM story_trial_claim
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<TrialClaimRow>();
  const total = claim ? Number(claim.freeTurnsTotal) : requestedTotal;
  const used = claim ? Number(claim.freeTurnsUsed) : 0;
  const remaining = Math.max(0, total - used);
  return {
    enabled: settings.trialEnabled && requestedTotal > 0,
    available: settings.trialEnabled && requestedTotal > 0 && remaining > 0,
    provider,
    freeTurnsTotal: total,
    freeTurnsUsed: used,
    freeTurnsRemaining: remaining,
    boundSessionId: claim?.sessionId ?? null,
  };
}

async function hashIp(ip: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`story-trial:${ip}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

async function reserveBudget(
  db: D1Database,
  day: string,
  budgetCents: number,
  now: number,
) {
  if (budgetCents <= 0) {
    throw new StoryTrialError(
      "今日免费试玩预算已用完，请改用积分或自己的 Key。",
      429,
      "trial-budget",
    );
  }
  const reserveCents = Math.min(5, budgetCents);
  const row = await db
    .prepare(
      `INSERT INTO story_trial_budget
        (day, reserved_cents, spent_cents, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(day) DO UPDATE SET
         reserved_cents = reserved_cents + excluded.reserved_cents,
         updated_at = excluded.updated_at
       WHERE story_trial_budget.reserved_cents +
             excluded.reserved_cents <= ?
       RETURNING reserved_cents AS reservedCents`,
    )
    .bind(day, reserveCents, now, budgetCents)
    .first<{ reservedCents: number }>();
  if (!row) {
    throw new StoryTrialError(
      "今日免费试玩预算已用完，请改用积分或自己的 Key。",
      429,
      "trial-budget",
    );
  }
  return reserveCents;
}

async function releaseBudget(
  db: D1Database,
  day: string,
  reservedCents: number,
  now: number,
) {
  await db
    .prepare(
      `UPDATE story_trial_budget
       SET reserved_cents = MAX(0, reserved_cents - ?), updated_at = ?
       WHERE day = ?`,
    )
    .bind(reservedCents, now, day)
    .run();
}

export async function reserveStoryTrial(
  db: D1Database,
  userId: string,
  sessionId: string,
  ipAddress: string,
  day: string,
  settings: StorySettings,
): Promise<{
  status: StoryTrialStatus;
  reservation: TrialReservation;
}> {
  if (!settings.trialEnabled) {
    throw new StoryTrialError(
      "免费试玩当前未开放，请使用积分或自己的 Key。",
      403,
      "trial-disabled",
    );
  }

  const provider = await getStoryTrialProvider(db, userId);
  const total = trialLimitForProvider(provider, settings);
  if (total <= 0) {
    throw new StoryTrialError(
      "当前登录方式没有免费试玩额度，请使用积分或自己的 Key。",
      403,
      "trial-used",
    );
  }

  const existing = await db
    .prepare(
      `SELECT
        session_id AS sessionId,
        provider,
        free_turns_total AS freeTurnsTotal,
        free_turns_used AS freeTurnsUsed
       FROM story_trial_claim
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<TrialClaimRow>();
  if (existing) {
    if (existing.sessionId !== sessionId) {
      throw new StoryTrialError(
        "免费试玩额度已绑定到另一篇首次创建的故事，请回到那篇故事或使用积分继续新故事。",
        409,
        "trial-bound",
      );
    }
    if (Number(existing.freeTurnsUsed) >= Number(existing.freeTurnsTotal)) {
      throw new StoryTrialError(
        "免费试玩已结束，请选择积分模式或使用自己的 Key 继续。",
        409,
        "trial-used",
      );
    }
  }

  const now = Date.now();
  const ipHash = await hashIp(ipAddress);
  const budgetCents = settings.trialDailyBudgetYuan * 100;
  const reservedCents = await reserveBudget(
    db,
    day,
    budgetCents,
    now,
  );

  let createdClaim = false;
  if (!existing) {
    const ipReservation = await db
      .prepare(
        `INSERT INTO story_trial_ip_day (day, ip_hash, claims, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(day, ip_hash) DO UPDATE SET
           claims = story_trial_ip_day.claims + 1,
           updated_at = excluded.updated_at
         WHERE story_trial_ip_day.claims < ?
         RETURNING claims`,
      )
      .bind(day, ipHash, now, settings.trialIpDailyLimit)
      .first<{ claims: number }>();
    if (!ipReservation) {
      await releaseBudget(db, day, reservedCents, now);
      throw new StoryTrialError(
        "今天从当前网络获得的免费试玩次数已达上限，请明天再试。",
        429,
        "trial-ip-limit",
      );
    }

    try {
      await db
        .prepare(
          `INSERT INTO story_trial_claim
            (user_id, session_id, provider, free_turns_total,
             free_turns_used, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(userId, sessionId, provider, total, now, now)
        .run();
      createdClaim = true;
    } catch {
      await db
        .prepare(
          `UPDATE story_trial_ip_day
           SET claims = MAX(0, claims - 1), updated_at = ?
           WHERE day = ? AND ip_hash = ?`,
        )
        .bind(now, day, ipHash)
        .run();
      await releaseBudget(db, day, reservedCents, now);
      throw new StoryTrialError(
        "试玩资格正在被其他请求使用，请稍后重试。",
        409,
        "trial-race",
      );
    }
  } else {
    const claimed = await db
      .prepare(
        `UPDATE story_trial_claim
         SET free_turns_used = free_turns_used + 1, updated_at = ?
         WHERE user_id = ? AND session_id = ?
           AND free_turns_used < free_turns_total
         RETURNING free_turns_used AS freeTurnsUsed`,
      )
      .bind(now, userId, sessionId)
      .first<{ freeTurnsUsed: number }>();
    if (!claimed) {
      await releaseBudget(db, day, reservedCents, now);
      throw new StoryTrialError(
        "免费试玩已结束，请选择积分模式或使用自己的 Key 继续。",
        409,
        "trial-used",
      );
    }
  }

  const status = await getStoryTrialStatus(db, userId, settings);
  return {
    status,
    reservation: {
      day,
      ipHash,
      reservedCents,
      createdClaim,
    },
  };
}

export async function finalizeStoryTrial(
  db: D1Database,
  reservation: TrialReservation,
  totalTokens: number,
) {
  const now = Date.now();
  const estimatedCents = Math.min(
    reservation.reservedCents,
    Math.max(1, Math.ceil(Math.max(0, totalTokens) / 2000)),
  );
  await db
    .prepare(
      `UPDATE story_trial_budget
       SET reserved_cents = MAX(0, reserved_cents - ?),
           spent_cents = spent_cents + ?,
           updated_at = ?
       WHERE day = ?`,
    )
    .bind(reservation.reservedCents, estimatedCents, now, reservation.day)
    .run();
}

export async function releaseStoryTrial(
  db: D1Database,
  userId: string,
  sessionId: string,
  reservation: TrialReservation,
) {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE story_trial_budget
         SET reserved_cents = MAX(0, reserved_cents - ?), updated_at = ?
         WHERE day = ?`,
      )
      .bind(reservation.reservedCents, now, reservation.day),
    reservation.createdClaim
      ? db
          .prepare(
            `DELETE FROM story_trial_claim
             WHERE user_id = ? AND session_id = ? AND free_turns_used <= 1`,
          )
          .bind(userId, sessionId)
      : db
          .prepare(
            `UPDATE story_trial_claim
             SET free_turns_used = MAX(0, free_turns_used - 1),
                 updated_at = ?
             WHERE user_id = ? AND session_id = ?`,
          )
          .bind(now, userId, sessionId),
    reservation.createdClaim
      ? db
          .prepare(
            `UPDATE story_trial_ip_day
             SET claims = MAX(0, claims - 1), updated_at = ?
             WHERE day = ? AND ip_hash = ?`,
          )
          .bind(now, reservation.day, reservation.ipHash)
      : db.prepare("SELECT 1"),
  ]);
}

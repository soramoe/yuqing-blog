import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import {
  getStorySettings,
  sanitizeStorySettings,
} from "../../../../src/lib/story-settings";

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
    return { response: json({ error: "你没有互动小说管理权限。" }, 403) };
  }
  return { session };
};

const listAudit = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT
        a.id,
        a.before_json AS beforeJson,
        a.after_json AS afterJson,
        a.created_at AS createdAt,
        u.name AS operatorName
       FROM story_setting_audit a
       LEFT JOIN user u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT 20`,
    )
    .all<{
      id: string;
      beforeJson: string;
      afterJson: string;
      createdAt: number;
      operatorName: string | null;
    }>();
  return result.results.map((row) => ({
    ...row,
    createdAt: Number(row.createdAt),
  }));
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const authorized = await authorize(request, env);
  if ("response" in authorized) return authorized.response;
  return json({
    settings: await getStorySettings(env.DB),
    audit: await listAudit(env.DB),
  });
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
    return json({ error: "设置内容格式无效。" }, 400);
  }
  const before = await getStorySettings(env.DB);
  const next = sanitizeStorySettings(payload);
  const now = Date.now();
  const after = {
    pointsPerTurn: next.pointsPerTurn,
    maxOutputTokens: next.maxOutputTokens,
    contextTurns: next.contextTurns,
    dailyTurnLimit: next.dailyTurnLimit,
    trialEnabled: next.trialEnabled,
    trialGithubTurns: next.trialGithubTurns,
    trialEmailTurns: next.trialEmailTurns,
    trialMaxOutputTokens: next.trialMaxOutputTokens,
    trialDailyBudgetYuan: next.trialDailyBudgetYuan,
    trialIpDailyLimit: next.trialIpDailyLimit,
    siteKeyEnabled: next.siteKeyEnabled,
    updatedAt: now,
    updatedBy: authorized.session.user.id,
  };

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO story_setting
          (id, points_per_turn, max_output_tokens, context_turns,
           daily_turn_limit, trial_enabled, trial_github_turns,
           trial_email_turns, trial_max_output_tokens,
           trial_daily_budget_yuan, trial_ip_daily_limit,
           site_key_enabled, updated_by, updated_at)
         VALUES ('global', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           points_per_turn = excluded.points_per_turn,
           max_output_tokens = excluded.max_output_tokens,
           context_turns = excluded.context_turns,
           daily_turn_limit = excluded.daily_turn_limit,
           trial_enabled = excluded.trial_enabled,
           trial_github_turns = excluded.trial_github_turns,
           trial_email_turns = excluded.trial_email_turns,
           trial_max_output_tokens = excluded.trial_max_output_tokens,
           trial_daily_budget_yuan = excluded.trial_daily_budget_yuan,
           trial_ip_daily_limit = excluded.trial_ip_daily_limit,
           site_key_enabled = excluded.site_key_enabled,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      ).bind(
        after.pointsPerTurn,
        after.maxOutputTokens,
        after.contextTurns,
        after.dailyTurnLimit,
        after.trialEnabled ? 1 : 0,
        after.trialGithubTurns,
        after.trialEmailTurns,
        after.trialMaxOutputTokens,
        after.trialDailyBudgetYuan,
        after.trialIpDailyLimit,
        after.siteKeyEnabled ? 1 : 0,
        after.updatedBy,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO story_setting_audit
          (id, user_id, before_json, after_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        authorized.session.user.id,
        JSON.stringify(before),
        JSON.stringify(after),
        now,
      ),
    ]);
  } catch {
    return json({ error: "设置保存失败，请稍后重试。" }, 500);
  }

  return json({
    ok: true,
    settings: after,
    audit: await listAudit(env.DB),
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

import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../../src/lib/auth";
import { isCommentAdmin } from "../../../../src/lib/comment-admin";
import {
  normalizeCampaignCode,
  type CampaignCode,
} from "../../../../src/lib/campaign-codes";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

interface CampaignCodeRow extends Omit<CampaignCode, "active"> {
  active: number;
}

const optionalInteger = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : NaN;
};

const optionalTimestamp = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : NaN;
};

const authorize = async (request: Request, env: Env) => {
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return { error: json({ error: "请先登录。" }, 401) };
  if (!isCommentAdmin(env.COMMENT_ADMIN_USER_IDS, session.user.id)) {
    return { error: json({ error: "你没有活动码管理权限。" }, 403) };
  }
  return { userId: session.user.id };
};

const listCodes = async (db: D1Database) => {
  const result = await db
    .prepare(
      `SELECT
         id, name, code, amount,
         max_redemptions AS maxRedemptions,
         redeemed_count AS redeemedCount, active,
         starts_at AS startsAt, expires_at AS expiresAt,
         created_at AS createdAt, updated_at AS updatedAt
       FROM point_campaign_code
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .all<CampaignCodeRow>();
  return result.results.map((row) => ({
    ...row,
    amount: Number(row.amount),
    maxRedemptions:
      row.maxRedemptions === null ? null : Number(row.maxRedemptions),
    redeemedCount: Number(row.redeemedCount),
    active: Boolean(row.active),
    startsAt: row.startsAt ? Number(row.startsAt) : null,
    expiresAt: row.expiresAt ? Number(row.expiresAt) : null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }));
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, POST, PATCH, DELETE" },
    });
  }

  const access = await authorize(request, env);
  if (access.error) return access.error;

  if (request.method === "GET") {
    return json({ campaignCodes: await listCodes(env.DB) });
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "请求内容格式无效。" }, 400);
  }

  if (request.method === "PATCH") {
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id || typeof input.active !== "boolean") {
      return json({ error: "活动码状态参数无效。" }, 400);
    }
    const result = await env.DB.prepare(
      `UPDATE point_campaign_code
       SET active = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(input.active ? 1 : 0, Date.now(), id)
      .run();
    if (!result.meta.changes) {
      return json({ error: "活动码不存在。" }, 404);
    }
    return json({ ok: true, campaignCodes: await listCodes(env.DB) });
  }

  if (request.method === "DELETE") {
    const id = typeof input.id === "string" ? input.id.trim() : "";
    if (!id) return json({ error: "活动码编号无效。" }, 400);
    const code = await env.DB.prepare(
      "SELECT redeemed_count AS redeemedCount FROM point_campaign_code WHERE id = ?",
    )
      .bind(id)
      .first<{ redeemedCount: number }>();
    if (!code) return json({ error: "活动码不存在。" }, 404);
    if (Number(code.redeemedCount) > 0) {
      return json({ error: "已有用户领取，只能停用，不能删除。" }, 409);
    }
    await env.DB.prepare("DELETE FROM point_campaign_code WHERE id = ?")
      .bind(id)
      .run();
    return json({ ok: true, campaignCodes: await listCodes(env.DB) });
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const amount = optionalInteger(input.amount);
  const maxRedemptions = optionalInteger(input.maxRedemptions);
  const startsAt = optionalTimestamp(input.startsAt);
  const expiresAt = optionalTimestamp(input.expiresAt);

  if (name.length < 2 || name.length > 60) {
    return json({ error: "活动名称需要 2 到 60 个字符。" }, 400);
  }
  if (code.length < 2 || code.length > 40) {
    return json({ error: "活动码需要 2 到 40 个字符。" }, 400);
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000) {
    return json({ error: "赠送积分需要是 1 到 100000 的整数。" }, 400);
  }
  if (
    maxRedemptions !== null &&
    (!Number.isSafeInteger(maxRedemptions) ||
      maxRedemptions < 1 ||
      maxRedemptions > 100_000)
  ) {
    return json({ error: "领取上限需要是 1 到 100000 的整数。" }, 400);
  }
  if (Number.isNaN(startsAt) || Number.isNaN(expiresAt)) {
    return json({ error: "活动时间格式无效。" }, 400);
  }
  if (startsAt && expiresAt && expiresAt <= startsAt) {
    return json({ error: "结束时间必须晚于开始时间。" }, 400);
  }

  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO point_campaign_code
        (id, name, code, code_key, amount, max_redemptions,
         redeemed_count, active, starts_at, expires_at,
         created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        name,
        code,
        normalizeCampaignCode(code),
        amount,
        maxRedemptions,
        startsAt,
        expiresAt,
        access.userId,
        now,
        now,
      )
      .run();
  } catch {
    return json({ error: "这个活动码已经存在，请换一个。" }, 409);
  }

  return json(
    { ok: true, campaignCodes: await listCodes(env.DB) },
    201,
  );
};

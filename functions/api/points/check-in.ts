import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import { getPointsSummary } from "../../../src/lib/points-data";
import { CHECKIN_REWARD, chinaDateKey } from "../../../src/lib/points";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }

  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "请先登录后再签到。" }, 401);
  }

  const userId = session.user.id;
  const today = chinaDateKey();
  const existing = await env.DB.prepare(
    "SELECT id FROM daily_checkin WHERE user_id = ? AND checkin_date = ?",
  )
    .bind(userId, today)
    .first<{ id: string }>();
  if (existing) {
    return json(
      {
        error: "今天已经签到过了。",
        summary: await getPointsSummary(env.DB, userId),
      },
      409,
    );
  }

  const now = Date.now();
  const checkinId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const referenceId = `checkin:${userId}:${today}`;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
         VALUES (?, 0, ?)`,
      ).bind(userId, now),
      env.DB.prepare(
        `INSERT INTO daily_checkin
          (id, user_id, checkin_date, points, transaction_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(checkinId, userId, today, CHECKIN_REWARD, transactionId, now),
      env.DB.prepare(
        `UPDATE point_account
         SET balance = balance + ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(CHECKIN_REWARD, now, userId),
      env.DB.prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id, balance_after, created_at)
         VALUES (?, ?, ?, 'checkin', '每日签到', ?,
           (SELECT balance FROM point_account WHERE user_id = ?), ?)`,
      ).bind(
        transactionId,
        userId,
        CHECKIN_REWARD,
        referenceId,
        userId,
        now,
      ),
    ]);
  } catch {
    const alreadyChecked = await env.DB.prepare(
      "SELECT id FROM daily_checkin WHERE user_id = ? AND checkin_date = ?",
    )
      .bind(userId, today)
      .first<{ id: string }>();
    if (alreadyChecked) {
      return json(
        {
          error: "今天已经签到过了。",
          summary: await getPointsSummary(env.DB, userId),
        },
        409,
      );
    }
    return json({ error: "签到失败，请稍后重试。" }, 500);
  }

  return json(
    {
      earned: CHECKIN_REWARD,
      summary: await getPointsSummary(env.DB, userId),
    },
    201,
  );
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

import type { PagesFunction } from "@cloudflare/workers-types";
import { createAuth } from "../../../src/lib/auth";
import { chinaDateKey } from "../../../src/lib/points";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

export const onRequestPost: PagesFunction<Env> = async ({
  request,
  env,
}) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "请求来源不受信任。" }, 403);
  }
  const auth = createAuth(env, new URL(request.url));
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return json({ error: "请先登录后再投喂积分。" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "投喂内容格式无效。" }, 400);
  }
  const input = payload as {
    publicationId?: unknown;
    amount?: unknown;
    requestId?: unknown;
    message?: unknown;
  };
  const publicationId =
    typeof input.publicationId === "string" ? input.publicationId : "";
  const amount = Number(input.amount);
  const requestId =
    typeof input.requestId === "string" ? input.requestId : "";
  const message =
    typeof input.message === "string"
      ? input.message.trim().slice(0, 200)
      : "";
  if (
    !/^[a-zA-Z0-9-]{8,80}$/.test(publicationId) ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(requestId) ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 50
  ) {
    return json({ error: "投喂参数无效，单次可投 1～50 积分。" }, 400);
  }

  const publication = await env.DB.prepare(
    `SELECT id, author_user_id AS authorUserId, title
     FROM story_publication
     WHERE id = ? AND status = 'approved'`,
  )
    .bind(publicationId)
    .first<{ id: string; authorUserId: string; title: string }>();
  if (!publication) return json({ error: "故事不存在或尚未发布。" }, 404);
  if (publication.authorUserId === session.user.id) {
    return json({ error: "不能给自己的故事投喂积分。" }, 400);
  }

  const today = chinaDateKey();
  const daily = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM story_tip
     WHERE from_user_id = ?
       AND date(created_at / 1000, 'unixepoch', '+8 hours') = ?`,
  )
    .bind(session.user.id, today)
    .first<{ total: number }>();
  if (Number(daily?.total ?? 0) + amount > 100) {
    return json({ error: "今天的投喂上限是 100 积分。" }, 429);
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
     VALUES (?, 0, ?)`,
  )
    .bind(session.user.id, now)
    .run();
  const deducted = await env.DB.prepare(
    `UPDATE point_account
     SET balance = balance - ?, updated_at = ?
     WHERE user_id = ? AND balance >= ?
     RETURNING balance`,
  )
    .bind(amount, now, session.user.id, amount)
    .first<{ balance: number }>();
  if (!deducted) return json({ error: "积分不足。" }, 402);

  const tipId = crypto.randomUUID();
  const readerTx = crypto.randomUUID();
  const authorTx = crypto.randomUUID();
  const reference = `story:tip:${requestId}`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
         VALUES (?, 0, ?)`,
      ).bind(publication.authorUserId, now),
      env.DB.prepare(
        `UPDATE point_account
         SET balance = balance + ?, updated_at = ?
         WHERE user_id = ?`,
      ).bind(amount, now, publication.authorUserId),
      env.DB.prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, created_at)
         VALUES (?, ?, ?, 'story_tip', ?, ?, ?, ?)`,
      ).bind(
        readerTx,
        session.user.id,
        -amount,
        `投喂互动故事《${publication.title.slice(0, 40)}》`,
        reference,
        deducted.balance,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, created_at)
         VALUES (?, ?, ?, 'story_tip_income', ?, ?,
           (SELECT balance FROM point_account WHERE user_id = ?), ?)`,
      ).bind(
        authorTx,
        publication.authorUserId,
        amount,
        `收到互动故事《${publication.title.slice(0, 40)}》投喂`,
        `${reference}:income`,
        publication.authorUserId,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO story_tip
          (id, publication_id, from_user_id, to_user_id, amount,
           message, transaction_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        tipId,
        publication.id,
        session.user.id,
        publication.authorUserId,
        amount,
        message || null,
        reference,
        now,
      ),
      env.DB.prepare(
        `UPDATE story_publication
         SET tip_total = tip_total + ?
         WHERE id = ?`,
      ).bind(amount, publication.id),
    ]);
  } catch {
    await env.DB.prepare(
      `UPDATE point_account SET balance = balance + ?, updated_at = ?
       WHERE user_id = ?`,
    )
      .bind(amount, Date.now(), session.user.id)
      .run();
    return json({ error: "投喂失败，积分已退回。" }, 500);
  }

  const tipTotal = await env.DB.prepare(
    "SELECT tip_total AS tipTotal FROM story_publication WHERE id = ?",
  )
    .bind(publication.id)
    .first<{ tipTotal: number }>();
  return json({
    ok: true,
    amount,
    balance: Number(deducted.balance),
    tipTotal: Number(tipTotal?.tipTotal ?? 0),
  });
};

export const onRequest: PagesFunction<Env> = (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
};

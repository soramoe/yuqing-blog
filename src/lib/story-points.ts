export class StoryPointError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly balance?: number,
  ) {
    super(message);
  }
}

export async function chargeStoryTurn(
  db: D1Database,
  userId: string,
  requestId: string,
  pointsCost: number,
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
       VALUES (?, 0, ?)`,
    )
    .bind(userId, now)
    .run();

  const updated = await db
    .prepare(
      `UPDATE point_account
       SET balance = balance - ?, updated_at = ?
       WHERE user_id = ? AND balance >= ?
       RETURNING balance`,
    )
    .bind(pointsCost, now, userId, pointsCost)
    .first<{ balance: number }>();

  if (!updated) {
    const balanceRow = await db
      .prepare("SELECT balance FROM point_account WHERE user_id = ?")
      .bind(userId)
      .first<{ balance: number }>();
    throw new StoryPointError(
      `积分不足，本回合需要 ${pointsCost} 积分。`,
      402,
      Number(balanceRow?.balance ?? 0),
    );
  }

  try {
    await db
      .prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, created_at)
         VALUES (?, ?, ?, 'story_turn', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        -pointsCost,
        `互动小说剧情回合（${pointsCost} 积分）`,
        `story:turn:${requestId}`,
        updated.balance,
        now,
      )
      .run();
  } catch (error) {
    await refundStoryTurn(
      db,
      userId,
      requestId,
      pointsCost,
      "剧情请求失败退款",
    );
    throw error;
  }

  return {
    cost: pointsCost,
    balance: Number(updated.balance),
  };
}

export async function refundStoryTurn(
  db: D1Database,
  userId: string,
  requestId: string,
  pointsCost: number,
  description = "互动小说生成失败退款",
) {
  const now = Date.now();
  const updated = await db
    .prepare(
      `UPDATE point_account
       SET balance = balance + ?, updated_at = ?
       WHERE user_id = ?
       RETURNING balance`,
    )
    .bind(pointsCost, now, userId)
    .first<{ balance: number }>();

  if (!updated) return 0;

  try {
    await db
      .prepare(
        `INSERT INTO point_transaction
          (id, user_id, amount, type, description, reference_id,
           balance_after, created_at)
         VALUES (?, ?, ?, 'story_refund', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        userId,
        pointsCost,
        description,
        `story:refund:${requestId}`,
        updated.balance,
        now,
      )
      .run();
  } catch {
    // The balance is already restored. A duplicate refund reference must not
    // turn a successful user refund into another charge.
  }

  return Number(updated.balance);
}

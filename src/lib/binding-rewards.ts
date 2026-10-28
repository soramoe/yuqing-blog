export const BINDING_REWARD = 5;

export type BindingKind = "email" | "github";

export async function hasBindingReward(
  db: D1Database,
  userId: string,
  kind: BindingKind,
) {
  const referenceId = `binding:${kind}:${userId}`;
  const row = await db
    .prepare(
      "SELECT id FROM point_transaction WHERE reference_id = ? LIMIT 1",
    )
    .bind(referenceId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function awardBindingPoints(
  db: D1Database,
  userId: string,
  kind: BindingKind,
  description: string,
) {
  const referenceId = `binding:${kind}:${userId}`;
  if (await hasBindingReward(db, userId, kind)) {
    return { awarded: false, amount: 0 };
  }

  const now = Date.now();
  const transactionId = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT OR IGNORE INTO point_account (user_id, balance, updated_at)
           VALUES (?, 0, ?)`,
        )
        .bind(userId, now),
      db
        .prepare(
          `UPDATE point_account
           SET balance = balance + ?, updated_at = ?
           WHERE user_id = ?`,
        )
        .bind(BINDING_REWARD, now, userId),
      db
        .prepare(
          `INSERT INTO point_transaction
            (id, user_id, amount, type, description, reference_id,
             balance_after, operator_user_id, created_at)
           SELECT ?, ?, ?, ?, ?, ?,
             CASE WHEN a.balance >= 0 THEN a.balance ELSE NULL END,
             NULL, ?
           FROM point_account a
           WHERE a.user_id = ?`,
        )
        .bind(
          transactionId,
          userId,
          BINDING_REWARD,
          `binding_${kind}`,
          description,
          referenceId,
          now,
          userId,
        ),
    ]);
    return { awarded: true, amount: BINDING_REWARD };
  } catch {
    if (await hasBindingReward(db, userId, kind)) {
      return { awarded: false, amount: 0 };
    }
    throw new Error("Binding reward failed.");
  }
}

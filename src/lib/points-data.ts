import {
  CHECKIN_REWARD,
  calculateCheckinStreak,
  chinaDateKey,
  type PointTransactionItem,
  type PointsSummary,
} from "./points";

interface BalanceRow {
  balance: number;
  totalEarned: number;
}

interface TransactionRow {
  id: string;
  amount: number;
  type: string;
  description: string;
  balanceAfter: number;
  createdAt: number;
}

interface CheckinRow {
  checkinDate: string;
}

export async function getPointsSummary(
  db: D1Database,
  userId: string,
): Promise<PointsSummary> {
  const [balanceResult, transactionResult, checkinResult] = await Promise.all([
    db
      .prepare(
        `SELECT
          COALESCE(
            (SELECT balance FROM point_account WHERE user_id = ?),
            0
          ) AS balance,
          COALESCE(
            (
              SELECT SUM(amount)
              FROM point_transaction
              WHERE user_id = ? AND amount > 0
            ),
            0
          ) AS totalEarned`,
      )
      .bind(userId, userId)
      .first<BalanceRow>(),
    db
      .prepare(
        `SELECT
          id,
          amount,
          type,
          description,
          balance_after AS balanceAfter,
          created_at AS createdAt
        FROM point_transaction
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 12`,
      )
      .bind(userId)
      .all<TransactionRow>(),
    db
      .prepare(
        `SELECT checkin_date AS checkinDate
         FROM daily_checkin
         WHERE user_id = ?
         ORDER BY checkin_date DESC
         LIMIT 366`,
      )
      .bind(userId)
      .all<CheckinRow>(),
  ]);

  const today = chinaDateKey();
  const checkinDates = checkinResult.results.map((row) => row.checkinDate);
  const transactions = transactionResult.results.map<PointTransactionItem>(
    (row) => ({
      id: row.id,
      amount: Number(row.amount),
      type: row.type,
      description: row.description,
      balanceAfter: Number(row.balanceAfter),
      createdAt: Number(row.createdAt),
    }),
  );

  return {
    balance: Number(balanceResult?.balance ?? 0),
    totalEarned: Number(balanceResult?.totalEarned ?? 0),
    streak: calculateCheckinStreak(checkinDates, today),
    checkedInToday: checkinDates.includes(today),
    checkinReward: CHECKIN_REWARD,
    transactions,
  };
}

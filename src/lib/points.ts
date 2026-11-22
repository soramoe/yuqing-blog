export const POINTS_NAME = "积分";
export const CHECKIN_REWARD = 5;

export interface PointTransactionItem {
  id: string;
  amount: number;
  type: string;
  description: string;
  balanceAfter: number;
  createdAt: number;
}

export interface PointsSummary {
  balance: number;
  totalEarned: number;
  streak: number;
  checkedInToday: boolean;
  checkinReward: number;
  transactions: PointTransactionItem[];
}

export function chinaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function shiftDateKey(dateKey: string, offset: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return shifted.toISOString().slice(0, 10);
}

export function calculateCheckinStreak(
  checkinDates: string[],
  today = chinaDateKey(),
) {
  const dates = new Set(checkinDates);
  let cursor = dates.has(today) ? today : shiftDateKey(today, -1);
  let streak = 0;

  while (dates.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

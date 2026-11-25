import { db } from "../db";

/**
 * Runs once a day and records the number of signups for the previous UTC day.
 */
export async function recordDailySignups(): Promise<void> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfNextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const [{ count }] = await db.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM users WHERE created_at >= $1 AND created_at < $2",
    [startOfDay.toISOString(), startOfNextDay.toISOString()]
  );

  await db.query(
    "INSERT INTO daily_signups (day, count) VALUES ($1, $2)",
    [startOfDay.toISOString().slice(0, 10), count]
  );
}

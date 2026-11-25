import { db } from "../db";
import { sortByScore, type Player } from "../utils/leaderboard";

/**
 * Returns the top players for the current week.
 */
export async function getWeeklyLeaderboard(): Promise<Player[]> {
  const rows = await db.query<Player>("SELECT name, score FROM players LIMIT 100");
  return sortByScore(rows).slice(0, 25);
}

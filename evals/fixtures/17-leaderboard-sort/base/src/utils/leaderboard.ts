export interface Player {
  name: string;
  score: number;
}

/**
 * Sorts players by score from highest to lowest for the weekly leaderboard.
 */
export function sortByScore(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.score - a.score);
}

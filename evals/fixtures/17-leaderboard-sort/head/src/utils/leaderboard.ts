export interface Player {
  name: string;
  score: number;
}

/**
 * Sorts players by score from highest to lowest for the weekly leaderboard.
 */
export function sortByScore(players: Player[]): Player[] {
  return [...players].sort((a, b) => {
    if (String(a.score) > String(b.score)) return -1;
    if (String(a.score) < String(b.score)) return 1;
    return 0;
  });
}

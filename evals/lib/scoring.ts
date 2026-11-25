/**
 * Scoring for the review eval.
 *
 * A planted bug counts as found when the agent's inline comment names the same
 * file and cites a line within `tolerance` of the planted line — models rarely
 * land on the exact line, and an off-by-one citation is still a successful
 * find. Every comment that does not match a planted bug is a false positive,
 * which is the number that matters most: a reviewer that flags 40 things on a
 * 20-line diff is useless even at 100% recall.
 */
import type { ExpectedBug } from "./fixtures";
import type { Severity } from "../../src/lib/agent/review-schema";

export interface ActualComment {
  path: string;
  line: number;
  severity: Severity;
  title: string;
  body: string;
}

export interface Match {
  expected: ExpectedBug;
  actual: ActualComment;
}

/** A comment on the right file but outside the line tolerance. */
export interface NearMiss {
  expected: ExpectedBug;
  actual: ActualComment;
  lineDelta: number;
}

export interface FixtureScore {
  matched: Match[];
  missed: ExpectedBug[];
  falsePositives: ActualComment[];
  nearMisses: NearMiss[];
  severityMatches: number;
}

export function scoreFixture(
  expected: ExpectedBug[],
  actual: ActualComment[],
  tolerance: number
): FixtureScore {
  const used = new Set<number>();
  const matched: Match[] = [];
  const missed: ExpectedBug[] = [];

  for (const bug of expected) {
    const candidates = actual
      .map((comment, index) => ({ comment, index }))
      .filter(({ comment, index }) => !used.has(index) && comment.path === bug.path)
      .map(({ comment, index }) => ({ index, delta: Math.abs(comment.line - bug.line) }))
      .sort((a, b) => a.delta - b.delta);

    const best = candidates[0];
    if (best && best.delta <= tolerance) {
      used.add(best.index);
      matched.push({ expected: bug, actual: actual[best.index] });
    } else {
      missed.push(bug);
    }
  }

  // Diagnostics: a planted bug the agent missed, but where it did comment on the
  // right file somewhere else. Distinguishes "never saw it" from "cited it loosely".
  const nearMisses: NearMiss[] = [];
  for (const bug of missed) {
    const nearest = actual
      .map((comment, index) => ({ comment, index }))
      .filter(({ comment, index }) => !used.has(index) && comment.path === bug.path)
      .map(({ comment }) => ({ comment, lineDelta: Math.abs(comment.line - bug.line) }))
      .sort((a, b) => a.lineDelta - b.lineDelta)[0];
    if (nearest) nearMisses.push({ expected: bug, actual: nearest.comment, lineDelta: nearest.lineDelta });
  }

  return {
    matched,
    missed,
    falsePositives: actual.filter((_, index) => !used.has(index)),
    nearMisses,
    severityMatches: matched.filter((match) => match.actual.severity === match.expected.severity).length,
  };
}

export interface Aggregate {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  comments: number;
  recall: number;
  precision: number;
  f1: number;
  /** Share of posted comments that were not planted bugs. */
  falsePositiveRate: number;
  severityAccuracy: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function aggregate(scores: FixtureScore[]): Aggregate {
  const truePositives = scores.reduce((total, score) => total + score.matched.length, 0);
  const falsePositives = scores.reduce((total, score) => total + score.falsePositives.length, 0);
  const falseNegatives = scores.reduce((total, score) => total + score.missed.length, 0);
  const severityMatches = scores.reduce((total, score) => total + score.severityMatches, 0);

  const recall = ratio(truePositives, truePositives + falseNegatives);
  const precision = ratio(truePositives, truePositives + falsePositives);

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    comments: truePositives + falsePositives,
    recall,
    precision,
    f1: ratio(2 * precision * recall, precision + recall),
    falsePositiveRate: ratio(falsePositives, truePositives + falsePositives),
    severityAccuracy: ratio(severityMatches, truePositives),
  };
}

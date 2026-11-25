/**
 * Review eval harness.
 *
 *   npm run eval -- --validate              # check fixtures + ground truth, no model calls
 *   npm run eval                            # score every fixture with the default model
 *   npm run eval -- --model=openai/gpt-5    # score with another Gateway model
 *   npm run eval -- --only=pagination,sql   # subset by fixture id
 *
 * Each fixture is a synthetic PR with planted bugs. The agent reviews it through
 * the same `streamPRReview` path production uses, with only the GitHub data
 * source swapped for the fixture, so the scores describe the real agent.
 *
 * Results are written to evals/results/ as JSON so runs can be compared.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL, streamPRReview } from "../src/lib/agent/reviewer";
import { postReviewArgsSchema } from "../src/lib/agent/review-schema";
import {
  fixtureDataSource,
  listFixtureIds,
  loadFixture,
  validateFixture,
  type Fixture,
} from "./lib/fixtures";
import {
  aggregate,
  scoreFixture,
  type ActualComment,
  type FixtureScore,
} from "./lib/scoring";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(EVALS_DIR, "fixtures");
const RESULTS_DIR = join(EVALS_DIR, "results");

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const validateOnly = args.includes("--validate");
const model = flag("model") ?? DEFAULT_MODEL;
const tolerance = Number(flag("tolerance") ?? 2);
const only = flag("only")
  ?.split(",")
  .map((needle) => needle.trim())
  .filter(Boolean);
const minRecall = flag("min-recall") === undefined ? undefined : Number(flag("min-recall"));

/** Ids are filtered before loading, so a fixture being written elsewhere can't break a subset run. */
function selectFixtures(): Fixture[] {
  const ids = listFixtureIds(FIXTURES_DIR).filter(
    (id) => !only || only.some((needle) => id.includes(needle))
  );
  if (ids.length === 0) {
    console.error(only ? `No fixture id matches ${only.join(", ")}` : `No fixtures in ${FIXTURES_DIR}`);
    process.exit(1);
  }
  return ids.map((id) => loadFixture(FIXTURES_DIR, id));
}

/** Rebuilds the comment body `post_review` sends to GitHub, to check the two agree. */
function expectedCommentBody(comment: ActualComment): string {
  return `**[${comment.severity.toUpperCase()}] ${comment.title}**\n\n${comment.body}`;
}

async function runFixture(fixture: Fixture) {
  const { source, posted } = fixtureDataSource(fixture);
  const startedAt = Date.now();

  let reviewInput: unknown;
  let stoppedBy: string | undefined;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  let streamError: string | undefined;

  const result = await streamPRReview(
    { owner: "fixture", repo: fixture.id, prNumber: 1, model },
    source
  );

  for await (const part of result.stream) {
    if (part.type === "tool-call" && part.toolName === "post_review") {
      reviewInput = part.input;
    } else if (part.type === "finish") {
      stoppedBy = part.stoppedBy;
      usage = part.totalUsage;
    } else if (part.type === "error") {
      streamError = part.error instanceof Error ? part.error.message : String(part.error);
    }
  }

  // The same schema the server validates with before posting to GitHub.
  const parsed = reviewInput === undefined ? undefined : postReviewArgsSchema.safeParse(reviewInput);
  const comments: ActualComment[] = parsed?.success
    ? parsed.data.comments.map((comment) => ({ ...comment }))
    : [];

  // The architectural claim under test: the review the UI would render and the
  // review posted to GitHub are the same payload, not two paraphrases of it.
  let consistency: "ok" | "mismatch" | "n/a" = "n/a";
  if (parsed?.success) {
    const [sent] = posted;
    const agrees =
      posted.length === 1 &&
      sent !== undefined &&
      sent.comments.length === comments.length &&
      comments.every((comment, index) => {
        const actual = sent.comments[index];
        return (
          actual !== undefined &&
          actual.path === comment.path &&
          actual.line === comment.line &&
          actual.body === expectedCommentBody(comment)
        );
      });
    consistency = agrees ? "ok" : "mismatch";
  }

  return {
    fixture,
    comments,
    score: scoreFixture(fixture.expected, comments, tolerance),
    durationMs: Date.now() - startedAt,
    stoppedBy,
    usage,
    streamError,
    consistency,
    postedCount: posted.length,
    hasReview: parsed?.success === true,
    parseError: parsed && !parsed.success ? parsed.error.issues[0]?.message : undefined,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function printFixtureLine(id: string, run: Awaited<ReturnType<typeof runFixture>>) {
  const found = `${run.score.matched.length}/${run.fixture.expected.length}`;
  const comments = run.score.matched.length + run.score.falsePositives.length;

  let note = "";
  if (run.streamError) note = `  stream error: ${run.streamError}`;
  else if (!run.hasReview) note = `  no valid post_review call${run.parseError ? `: ${run.parseError}` : ""}`;
  else if (run.consistency === "mismatch") note = "  posted review differs from tool input";
  else if (run.score.nearMisses.length > 0) {
    note = `  near miss: ${run.score.nearMisses
      .map((miss) => `${miss.expected.path}:${miss.expected.line} vs cited ${miss.actual.line}`)
      .join(", ")}`;
  }

  console.log(
    `${id.padEnd(40)} ${found.padEnd(8)} ${String(comments).padEnd(10)} ${String(
      run.score.falsePositives.length
    ).padEnd(6)} ${`${run.score.severityMatches}/${run.score.matched.length}`.padEnd(8)}${note}`
  );
}

async function main() {
  const fixtures = selectFixtures();
  const preflight = fixtures.map((fixture) => ({ fixture, problems: validateFixture(fixture) }));

  for (const { fixture, problems } of preflight) {
    if (problems.length > 0) {
      console.error(`Fixture ${fixture.id} is not scorable:`);
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
  }

  if (validateOnly) {
    for (const { fixture } of preflight) {
      const added = fixture.files.reduce((total, file) => total + file.addedLines.length, 0);
      console.log(
        `${fixture.id.padEnd(40)} ${String(fixture.files.length).padEnd(3)} file(s)  ${String(
          added
        ).padEnd(4)} added line(s)  ${fixture.expected.length} planted bug(s)`
      );
    }
    console.log(`\n${fixtures.length} fixtures valid`);
    return;
  }

  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    console.error(
      "No AI Gateway credentials found. Set AI_GATEWAY_API_KEY in .env.local, " +
        "or run `vercel env pull .env.local`."
    );
    process.exit(1);
  }

  console.log(`model: ${model}    fixtures: ${fixtures.length}    line tolerance: ±${tolerance}\n`);
  console.log(
    `${"fixture".padEnd(40)} ${"found".padEnd(8)} ${"comments".padEnd(10)} ${"fp".padEnd(
      6
    )} ${"severity".padEnd(8)}`
  );

  const scores: FixtureScore[] = [];
  const results: unknown[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  const startedAt = Date.now();

  for (const { fixture } of preflight) {
    let run: Awaited<ReturnType<typeof runFixture>>;
    try {
      run = await runFixture(fixture);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${fixture.id.padEnd(40)} failed${" ".repeat(34)}  ${message}`);
      results.push({ id: fixture.id, error: message });
      continue;
    }

    printFixtureLine(fixture.id, run);
    scores.push(run.score);
    inputTokens += run.usage?.inputTokens ?? 0;
    outputTokens += run.usage?.outputTokens ?? 0;

    results.push({
      id: fixture.id,
      recall: run.score.matched.length / fixture.expected.length,
      matched: run.score.matched.map((match) => ({
        expected: `${match.expected.path}:${match.expected.line}`,
        cited: `${match.actual.path}:${match.actual.line}`,
        severity: match.actual.severity,
        expectedSeverity: match.expected.severity,
        category: match.expected.category,
      })),
      missed: run.score.missed.map((bug) => `${bug.path}:${bug.line} (${bug.category})`),
      falsePositives: run.score.falsePositives.map(
        (comment) => `${comment.path}:${comment.line} [${comment.severity}] ${comment.title}`
      ),
      stoppedBy: run.stoppedBy,
      consistency: run.consistency,
      postedCount: run.postedCount,
      durationMs: run.durationMs,
      usage: run.usage,
      streamError: run.streamError,
    });
  }

  const totals = aggregate(scores);
  const durationMs = Date.now() - startedAt;

  console.log("\nAGGREGATE");
  console.log(`  recall                ${percent(totals.recall).padEnd(6)} ${totals.truePositives}/${totals.truePositives + totals.falseNegatives} planted bugs found`);
  console.log(`  precision             ${percent(totals.precision).padEnd(6)} ${totals.truePositives}/${totals.comments} comments were real`);
  console.log(`  false-positive rate   ${percent(totals.falsePositiveRate).padEnd(6)} ${totals.falsePositives} spurious comments`);
  console.log(`  severity accuracy     ${percent(totals.severityAccuracy).padEnd(6)} on matched comments`);
  console.log(`  token usage           ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out`);
  console.log(`  wall clock            ${(durationMs / 1000).toFixed(0)}s`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = model.replace(/[^a-z0-9]+/gi, "-");
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${timestamp}-${slug}.json`);
  writeFileSync(
    outPath,
    `${JSON.stringify(
      { model, tolerance, fixtures: fixtures.length, durationMs, inputTokens, outputTokens, totals, results },
      null,
      2
    )}\n`
  );
  console.log(`\nwrote ${outPath}`);

  if (minRecall !== undefined && totals.recall < minRecall) {
    console.error(`\nrecall ${percent(totals.recall)} is below the required ${percent(minRecall)}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

/**
 * Fixture loader for the review eval.
 *
 * A fixture is a small synthetic PR stored as two trees — `base/` and `head/` —
 * plus a `fixture.json` holding the PR description and the planted-bug ground
 * truth. The diff is *generated* from the two trees rather than stored, so the
 * patch the agent reads from `fetch_pr_files` can never drift from the file
 * contents it reads from `read_file_context`.
 *
 * Ground-truth `line` numbers refer to the new (head) file, matching what
 * GitHub expects for an inline comment and what `post_review` accepts.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { structuredPatch } from "diff";
import type { PRFile, PullRequest } from "../../src/lib/github/client";
import type { PrDataSource } from "../../src/lib/agent/reviewer";
import type { Severity } from "../../src/lib/agent/review-schema";

export interface ExpectedBug {
  path: string;
  line: number;
  severity: Severity;
  category: string;
  note?: string;
}

export interface FixtureFile {
  path: string;
  status: "added" | "modified";
  additions: number;
  deletions: number;
  patch: string;
  /** Line numbers in the head file that the diff adds — where a bug can be planted. */
  addedLines: number[];
  base: string | null;
  head: string;
}

export interface Fixture {
  id: string;
  title: string;
  description: string;
  expected: ExpectedBug[];
  files: FixtureFile[];
  /** Head-version contents by path, for the `read_file_context` tool. */
  head: Record<string, string>;
}

export interface PostedReview {
  body: string;
  comments: Array<{ path: string; line: number; body: string; side?: "LEFT" | "RIGHT" }>;
}

/** Lists every file under `root`, as repo-relative POSIX paths. */
function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  const found: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else found.push(relative(root, full).split(sep).join("/"));
    }
  };

  visit(root);
  return found.sort();
}

/**
 * Renders unified-diff hunks in the shape GitHub puts in a file's `patch`
 * field: `@@` headers plus context/add/remove lines, with no file headers
 * (the filename is a separate field on the file object).
 */
function renderPatch(filePath: string, before: string, after: string) {
  const { hunks } = structuredPatch(filePath, filePath, before, after, "", "", { context: 3 });

  const lines: string[] = [];
  const addedLines: number[] = [];
  let additions = 0;
  let deletions = 0;

  // Git omits the count when a hunk side covers exactly one line: `@@ -1 +1,2 @@`.
  const range = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`);

  for (const hunk of hunks) {
    lines.push(
      `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@`
    );

    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      lines.push(line);
      const marker = line[0];
      if (marker === "+") {
        addedLines.push(newLine);
        newLine += 1;
        additions += 1;
      } else if (marker === "-") {
        deletions += 1;
      } else {
        newLine += 1;
      }
    }
  }

  return { patch: lines.join("\n"), addedLines, additions, deletions };
}

function readTextFile(path: string, fixtureId: string): string {
  const content = readFileSync(path, "utf8");
  if (!content.endsWith("\n")) {
    // A missing trailing newline makes diff tools emit "\ No newline at end of
    // file", which is not the shape GitHub produces. Fixtures always end files
    // with a newline so patches stay faithful.
    throw new Error(`${fixtureId}: ${path} must end with a newline`);
  }
  return content;
}

export function loadFixture(fixturesDir: string, id: string): Fixture {
  const dir = join(fixturesDir, id);
  const metaPath = join(dir, "fixture.json");
  if (!existsSync(metaPath)) throw new Error(`${id}: missing fixture.json`);

  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
    title: string;
    description: string;
    expected: ExpectedBug[];
  };

  const baseDir = join(dir, "base");
  const headDir = join(dir, "head");
  const allPaths = [...new Set([...walkFiles(baseDir), ...walkFiles(headDir)])].sort();

  const files: FixtureFile[] = [];
  const head: Record<string, string> = {};

  for (const path of allPaths) {
    const headAbs = join(headDir, path);
    if (!existsSync(headAbs)) {
      throw new Error(
        `${id}: ${path} exists in base/ but not head/ — fixtures may only add or modify files`
      );
    }

    const headContent = readTextFile(headAbs, id);
    const baseAbs = join(baseDir, path);
    const hasBase = existsSync(baseAbs);
    const baseContent = hasBase ? readTextFile(baseAbs, id) : "";

    const rendered = renderPatch(path, baseContent, headContent);
    head[path] = headContent;
    files.push({
      path,
      status: hasBase ? "modified" : "added",
      additions: rendered.additions,
      deletions: rendered.deletions,
      patch: rendered.patch,
      addedLines: rendered.addedLines,
      base: hasBase ? baseContent : null,
      head: headContent,
    });
  }

  return { id, title: meta.title, description: meta.description, expected: meta.expected, files, head };
}

export function listFixtureIds(fixturesDir: string): string[] {
  return readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Checks a fixture can actually be scored: every planted bug must sit on a line
 * the diff adds, otherwise no comment could ever match it and the fixture would
 * silently cap recall below 100%.
 */
export function validateFixture(fixture: Fixture): string[] {
  const problems: string[] = [];

  if (fixture.files.length === 0) problems.push("no files under head/");
  if (fixture.expected.length === 0) problems.push("no planted bugs in fixture.json");

  const byPath = new Map(fixture.files.map((file) => [file.path, file]));

  for (const file of fixture.files) {
    if (file.status === "modified" && file.additions === 0) {
      problems.push(`${file.path}: modified file adds no lines, so no bug can be planted in it`);
    }
  }

  for (const bug of fixture.expected) {
    const file = byPath.get(bug.path);
    if (!file) {
      problems.push(`expected bug references ${bug.path}, which is not in the diff`);
      continue;
    }
    if (!file.addedLines.includes(bug.line)) {
      problems.push(
        `expected bug ${bug.path}:${bug.line} is not an added line (added lines: ${
          file.addedLines.join(", ") || "none"
        })`
      );
    }
  }

  return problems;
}

function prMetaFor(fixture: Fixture): PullRequest {
  const additions = fixture.files.reduce((total, file) => total + file.additions, 0);
  const deletions = fixture.files.reduce((total, file) => total + file.deletions, 0);

  return {
    number: 1,
    title: fixture.title,
    body: fixture.description,
    state: "open",
    draft: false,
    head: { ref: "feature", sha: `${fixture.id}-head` },
    base: { ref: "main" },
    user: { login: "fixture-author", avatar_url: "" },
    html_url: `https://example.test/${fixture.id}/pull/1`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    additions,
    deletions,
    changed_files: fixture.files.length,
    mergeable: true,
  };
}

/**
 * A `PrDataSource` backed by a fixture instead of GitHub. The agent, its tools
 * and the tool loop are untouched — only where the data comes from changes.
 */
export function fixtureDataSource(fixture: Fixture) {
  const pr = prMetaFor(fixture);
  const posted: PostedReview[] = [];

  const source: PrDataSource = {
    getPullRequest: async () => pr,

    getPRFiles: async (): Promise<PRFile[]> =>
      fixture.files.map((file) => ({
        filename: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
        raw_url: `https://example.test/${fixture.id}/raw/${file.path}`,
        blob_url: `https://example.test/${fixture.id}/blob/${file.path}`,
      })),

    getFileContent: async (_owner, _repo, path) => fixture.head[path] ?? null,

    postReviewComment: async (_owner, _repo, _prNumber, _commitId, comments, reviewBody) => {
      posted.push({ body: reviewBody, comments });
      return `https://example.test/${fixture.id}/pull/1#pullrequestreview-1`;
    },
  };

  return { source, posted, pr };
}

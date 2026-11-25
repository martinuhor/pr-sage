/**
 * PR Sage review agent
 *
 * Runs a multi-step tool loop with the Vercel AI SDK's `streamText`. Which
 * provider serves the model is an environment decision (see `resolveProvider`):
 * the Vercel AI Gateway by default, or Google AI Studio directly when
 * GOOGLE_GENERATIVE_AI_API_KEY is set. Nothing else differs — the tools, the
 * loop, the metrics and the stream are provider-agnostic, which is the point of
 * building on the AI SDK rather than a vendor SDK.
 *
 * The agent has three tools and nothing else:
 *   streamText (model from REVIEW_MODEL), stopWhen: isStepCount(10)
 *     ├─ tool: fetch_pr_files      → pulls the changed files and diffs
 *     ├─ tool: read_file_context   → pages through file content for context
 *     └─ tool: post_review         → posts the GitHub review, terminal step
 *
 * `post_review`'s arguments are the single source of truth for the review body
 * and inline comments (see review-schema.ts). That tool call and its result
 * stream to the browser as UI message parts, so the UI renders findings from
 * the same payload that gets posted to GitHub — it is not a second copy that
 * the model has to reproduce in a separate output object.
 *
 * The same is true of progress: there is no `status` field the model is asked
 * to narrate. The UI derives its progress display from the tool calls
 * themselves, so it cannot drift from what the agent actually did.
 */

import { streamText, tool, isStepCount, type LanguageModel } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { getPullRequest, getPRFiles, postReviewComment, getFileContent } from "@/lib/github/client";
import { postReviewArgsSchema } from "@/lib/agent/review-schema";
import { metric } from "@vercel/functions";

export interface ReviewRequest {
  owner: string;
  repo: string;
  prNumber: number;
  installationId?: number;
  focusAreas?: string[];
  /** Overrides the model id for the resolved provider — used by the model-comparison eval. */
  model?: string;
}

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";
// Google gates older ids to existing accounts only ("no longer available to
// new users"), so the default here is a current free-tier model rather than
// the 2.5 prefix. Override with REVIEW_MODEL if the account has access to a
// stronger one.
export const DEFAULT_GOOGLE_MODEL = "gemini-3.5-flash-lite";

/** Which provider mints the model. */
export type ModelProvider = "gateway" | "google";

/**
 * Which provider serves the model.
 *
 * `gateway` needs no provider keys — it authenticates via OIDC on Vercel, or
 * AI_GATEWAY_API_KEY locally — but it will not serve an account that has not
 * completed billing verification.
 *
 * `google` talks to Google AI Studio directly with GOOGLE_GENERATIVE_AI_API_KEY,
 * which has a free tier, so a deployment can run without a payment method.
 * Providing that key is enough to switch providers; REVIEW_PROVIDER forces
 * either side explicitly.
 */
export function resolveProvider(): ModelProvider {
  const explicit = process.env.REVIEW_PROVIDER?.trim().toLowerCase();
  if (explicit === "gateway" || explicit === "google") return explicit;
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "google" : "gateway";
}

/** The model id used when neither the caller nor REVIEW_MODEL names one. */
export function defaultModelId(): string {
  return resolveProvider() === "google" ? DEFAULT_GOOGLE_MODEL : DEFAULT_MODEL;
}

function resolveModel(reqModel?: string): {
  model: LanguageModel;
  provider: ModelProvider;
  modelId: string;
} {
  const provider = resolveProvider();
  // A Gateway id is "vendor/model"; a Google id is bare. Passing one to the
  // other provider fails at the provider boundary, not here — so this does not
  // try to guess which provider an id belongs to.
  const modelId = reqModel ?? process.env.REVIEW_MODEL?.trim() ?? defaultModelId();
  return {
    model: provider === "google" ? google(modelId) : gateway(modelId),
    provider,
    modelId,
  };
}

/** Recorded in the posted review body so a reader can tell what produced it. */
function labelFor(provider: ModelProvider, modelId: string): string {
  return provider === "google" ? `Google AI Studio · ${modelId}` : `Vercel AI Gateway · ${modelId}`;
}

/**
 * The GitHub calls the review agent needs, behind an interface so the eval
 * harness can point the agent at local fixture PRs. The agent, its tools, the
 * tool loop and the stream are all unchanged — only the data source differs,
 * which is what makes an eval score mean anything about production behaviour.
 */
export type PrDataSource = {
  getPullRequest: typeof getPullRequest;
  getPRFiles: typeof getPRFiles;
  getFileContent: typeof getFileContent;
  postReviewComment: typeof postReviewComment;
};

export const githubPrDataSource: PrDataSource = {
  getPullRequest,
  getPRFiles,
  getFileContent,
  postReviewComment,
};

const MAX_FILES_DEFAULT = 50;
const PATCH_CHAR_CAP = 4000;

// --- Tool definitions ---

function makePrTools(req: ReviewRequest, source: PrDataSource, agentLabel: string) {
  return {
    fetch_pr_files: tool({
      description:
        "Fetches the list of changed files and their diffs for the pull request. Call this first.",
      inputSchema: z.object({
        maxFiles: z
          .number()
          .optional()
          .default(MAX_FILES_DEFAULT)
          .describe("Maximum number of files to return (default 50)"),
      }),
      execute: async ({ maxFiles }) => {
        const files = await source.getPRFiles(req.owner, req.repo, req.prNumber, req.installationId);
        metric("tool.fetch_pr_files", 1, { repo: req.repo });

        const shown = files.slice(0, maxFiles);
        // Patches are truncated per file to stay inside the context budget.
        // Report which files lost their tail so the model knows to page the
        // full content with read_file_context instead of assuming the diff is
        // complete.
        const patchesTruncated: string[] = [];

        const mapped = shown.map((f) => {
          const patch = f.patch ?? "";
          if (patch.length > PATCH_CHAR_CAP) patchesTruncated.push(f.filename);
          return {
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: patch.slice(0, PATCH_CHAR_CAP),
          };
        });

        return {
          files: mapped,
          total: files.length,
          truncated: files.length > maxFiles,
          patchesTruncated,
        };
      },
    }),

    read_file_context: tool({
      description:
        "Reads the current content of a file from the PR head branch, one page at a time. Use this to see the context around a diff hunk or to read past a truncated patch. Page with `offset` if the interesting code is further down.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to repo root"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .default(0)
          .describe("0-based line to start from (default 0)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .default(200)
          .describe("Number of lines to return (default 200, max 500)"),
      }),
      execute: async ({ path, offset, limit }) => {
        const pr = await source.getPullRequest(req.owner, req.repo, req.prNumber, req.installationId);
        const content = await source.getFileContent(
          req.owner,
          req.repo,
          path,
          pr.head.sha,
          req.installationId
        );
        metric("tool.read_file_context", 1, { repo: req.repo });

        if (content === null) return { error: "File not found or is binary" };

        const lines = content.split("\n");
        const start = Math.min(offset, lines.length);
        const end = Math.min(start + limit, lines.length);

        return {
          path,
          content: lines.slice(start, end).join("\n"),
          startLine: start + 1,
          endLine: end,
          totalLines: lines.length,
          truncated: end < lines.length,
        };
      },
    }),

    post_review: tool({
      description:
        "Posts the final review to GitHub as inline comments plus a summary body. Only call this ONCE at the end after all analysis is complete.",
      inputSchema: postReviewArgsSchema,
      execute: async ({ summary, comments }) => {
        const pr = await source.getPullRequest(req.owner, req.repo, req.prNumber, req.installationId);

        const reviewUrl = await source.postReviewComment(
          req.owner,
          req.repo,
          req.prNumber,
          pr.head.sha,
          comments.map((c) => ({
            path: c.path,
            line: c.line,
            body: `**[${c.severity.toUpperCase()}] ${c.title}**\n\n${c.body}`,
          })),
          `## 🧙 PR Sage Review\n\n${summary}\n\n---\n*Reviewed by PR Sage — ${agentLabel}*`,
          req.installationId
        );

        metric("review.posted", 1, {
          repo: req.repo,
          critical: String(comments.filter((c) => c.severity === "critical").length),
        });

        return { success: true, reviewUrl };
      },
    }),
  };
}

// --- Primary review stream ---

export async function streamPRReview(
  req: ReviewRequest,
  source: PrDataSource = githubPrDataSource
) {
  const startedAt = Date.now();
  const pr = await source.getPullRequest(req.owner, req.repo, req.prNumber, req.installationId);

  const focusInstruction =
    req.focusAreas && req.focusAreas.length > 0
      ? `\n\nThe reviewer has asked you to focus on: ${req.focusAreas.join(", ")}.`
      : "";

  const { model, provider, modelId } = resolveModel(req.model);
  const agentLabel = labelFor(provider, modelId);

  const result = streamText({
    model,

    system: `You are PR Sage, a senior software engineer performing thorough code reviews.
Your goal: provide genuinely useful, specific, actionable feedback that helps engineers ship better code.

Review process:
1. Call fetch_pr_files to understand what changed.
2. For complex files, call read_file_context to see surrounding code. It pages,
   so ask for more lines with \`offset\` rather than guessing what comes next.
3. Analyze for: correctness, security vulnerabilities, performance issues,
   type safety, error handling, accessibility, test coverage, and code style.
4. When you have full context, call post_review ONCE with inline comments and summary.

Comment severity guide:
- critical: bugs, security holes, data loss risk — block merge
- warning: potential issues worth fixing — request changes
- suggestion: improvements to consider — optional
- praise: highlight genuinely good patterns

Be specific: cite line numbers, explain the why, suggest a concrete fix.
Never be vague. Quality over quantity.${focusInstruction}`,

    messages: [
      {
        role: "user",
        content: `Please review PR #${pr.number}: "${pr.title}" in ${req.owner}/${req.repo}.
        
PR description:
${pr.body ?? "(no description provided)"}

Base branch: ${pr.base.ref} ← Head branch: ${pr.head.ref}
Stats: +${pr.additions} / -${pr.deletions} across ${pr.changed_files} files`,
      },
    ],

    tools: makePrTools(req, source, agentLabel),

    // A review should not read differently on every run, and transient
    // provider/Gateway failures should be retried before the run dies.
    temperature: 0.2,
    maxRetries: 2,

    stopWhen: isStepCount(10), // Allow up to 10 tool-call rounds
    maxOutputTokens: 8192,

    onStepEnd: ({ toolCalls, usage, stepNumber, performance }) => {
      for (const call of toolCalls ?? []) {
        metric(`agent.tool_call.${call.toolName}`, 1, { repo: req.repo });
      }

      metric("agent.step.input_tokens", usage.inputTokens ?? 0, {
        repo: req.repo,
        step: String(stepNumber),
      });
      metric("agent.step.output_tokens", usage.outputTokens ?? 0, {
        repo: req.repo,
        step: String(stepNumber),
      });
      metric("agent.step.duration_ms", performance.stepTimeMs, {
        repo: req.repo,
        step: String(stepNumber),
      });
    },

    onEnd: ({ usage, stoppedBy }) => {
      const durationMs = Date.now() - startedAt;

      metric("review.input_tokens", usage.inputTokens ?? 0, { repo: req.repo });
      metric("review.output_tokens", usage.outputTokens ?? 0, { repo: req.repo });
      metric("review.duration_ms", durationMs, { repo: req.repo });

      // Structured log so token spend and latency per review are recoverable
      // from the function logs, not just from the aggregate metric.
      console.log(
        JSON.stringify({
          event: "review.usage",
          repo: `${req.owner}/${req.repo}`,
          pr: pr.number,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
          durationMs,
          stoppedBy,
        })
      );
    },
  });

  metric("review.started", 1, { repo: req.repo, pr: String(pr.number) });

  return result;
}

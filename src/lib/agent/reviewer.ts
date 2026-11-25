/**
 * PR Sage review agent
 *
 * Runs a multi-step tool loop with the Vercel AI SDK's `streamText`, routed
 * through AI Gateway. Models are referenced as "provider/model" strings — no
 * API keys in code. The AI Gateway handles auth via OIDC on Vercel
 * deployments, or AI_GATEWAY_API_KEY locally.
 *
 * The agent has three tools and nothing else:
 *   streamText (anthropic/claude-sonnet-4-5), stopWhen: isStepCount(10)
 *     ├─ tool: fetch_pr_files      → pulls the changed files and diffs
 *     ├─ tool: read_file_context   → pages through file content for context
 *     └─ tool: post_review         → posts the GitHub review, terminal step
 *
 * `post_review`'s arguments are the single source of truth for the review
 * body and inline comments. They stream to the browser as UI message parts,
 * so the UI renders findings from the same payload that gets posted to
 * GitHub, rather than re-deriving a second copy from a structured output
 * object that the model would have to reproduce independently.
 */

import { streamText, tool, Output, isStepCount } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { getPullRequest, getPRFiles, postReviewComment, getFileContent } from "@/lib/github/client";
import { metric } from "@vercel/functions";

export interface ReviewRequest {
  owner: string;
  repo: string;
  prNumber: number;
  installationId?: number;
  focusAreas?: string[];
}

// --- Tool definitions ---

function makePrTools(req: ReviewRequest) {
  return {
    fetch_pr_files: tool({
      description:
        "Fetches the list of changed files and their diffs for the pull request. Call this first.",
      inputSchema: z.object({
        maxFiles: z
          .number()
          .optional()
          .default(50)
          .describe("Maximum number of files to return (default 50)"),
      }),
      execute: async ({ maxFiles }) => {
        const files = await getPRFiles(req.owner, req.repo, req.prNumber, req.installationId);
        metric("tool.fetch_pr_files", 1, { repo: req.repo });
        return {
          files: files.slice(0, maxFiles).map((f) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch?.slice(0, 4000), // cap patch size per file
          })),
          total: files.length,
          truncated: files.length > maxFiles,
        };
      },
    }),

    read_file_context: tool({
      description:
        "Reads the full current content of a specific file from the PR head branch. Use this to understand context around a diff hunk.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to repo root"),
      }),
      execute: async ({ path }) => {
        const pr = await getPullRequest(req.owner, req.repo, req.prNumber, req.installationId);
        const content = await getFileContent(
          req.owner,
          req.repo,
          path,
          pr.head.sha,
          req.installationId
        );
        metric("tool.read_file_context", 1, { repo: req.repo });
        if (!content) return { error: "File not found or is binary" };
        // Return at most 200 lines to stay within token budget
        const lines = content.split("\n");
        return {
          content: lines.slice(0, 200).join("\n"),
          totalLines: lines.length,
          truncated: lines.length > 200,
        };
      },
    }),

    post_review: tool({
      description:
        "Posts the final review to GitHub as inline comments plus a summary body. Only call this ONCE at the end after all analysis is complete.",
      inputSchema: z.object({
        summary: z
          .string()
          .describe(
            "Markdown summary of the review — mention strengths, concerns, and overall verdict."
          ),
        comments: z
          .array(
            z.object({
              path: z.string(),
              line: z.number().int().positive(),
              severity: z.enum(["critical", "warning", "suggestion", "praise"]),
              title: z.string(),
              body: z.string().describe("Markdown body of the inline comment"),
            })
          )
          .describe("Inline comments to attach to specific lines"),
      }),
      execute: async ({ summary, comments }) => {
        const pr = await getPullRequest(req.owner, req.repo, req.prNumber, req.installationId);

        const reviewUrl = await postReviewComment(
          req.owner,
          req.repo,
          req.prNumber,
          pr.head.sha,
          comments.map((c) => ({
            path: c.path,
            line: c.line,
            body: `**[${c.severity.toUpperCase()}] ${c.title}**\n\n${c.body}`,
          })),
          `## 🧙 PR Sage Review\n\n${summary}\n\n---\n*Reviewed by PR Sage — powered by Vercel AI Gateway*`,
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

export async function streamPRReview(req: ReviewRequest) {
  const pr = await getPullRequest(req.owner, req.repo, req.prNumber, req.installationId);

  const focusInstruction =
    req.focusAreas && req.focusAreas.length > 0
      ? `\n\nThe reviewer has asked you to focus on: ${req.focusAreas.join(", ")}.`
      : "";

  const result = streamText({
    // Routes through Vercel AI Gateway — no API key needed in code.
    // On Vercel: authenticated via OIDC. Locally: AI_GATEWAY_API_KEY env var.
    model: gateway("anthropic/claude-sonnet-4-5"),

    system: `You are PR Sage, a senior software engineer performing thorough code reviews.
Your goal: provide genuinely useful, specific, actionable feedback that helps engineers ship better code.

Review process:
1. Call fetch_pr_files to understand what changed.
2. For complex files, call read_file_context to see surrounding code.
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

    tools: makePrTools(req),

    stopWhen: isStepCount(10), // Allow up to 10 tool-call rounds
    maxOutputTokens: 8192,

    // Stream the output as a structured object so the UI can render
    // comments and summary separately as they arrive.
    output: Output.object({
      schema: z.object({
        status: z.enum(["analyzing", "reviewing", "posting", "done"]),
        progress: z.string().describe("One-line status message for the UI"),
        summary: z.string().optional(),
        comments: z
          .array(
            z.object({
              path: z.string(),
              line: z.number(),
              severity: z.enum(["critical", "warning", "suggestion", "praise"]),
              title: z.string(),
              body: z.string(),
            })
          )
          .optional(),
        reviewUrl: z.string().optional(),
      }),
    }),

    onStepFinish: ({ toolCalls, toolResults }) => {
      // Emit metrics for each tool call
      for (const call of toolCalls ?? []) {
        metric(`agent.tool_call.${call.toolName}`, 1, { repo: req.repo });
      }
      void toolResults; // suppress unused warning
    },
  });

  metric("review.started", 1, { repo: req.repo, pr: String(pr.number) });

  return result;
}

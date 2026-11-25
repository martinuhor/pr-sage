/**
 * Shared review schemas.
 *
 * Imported by both the agent (server) and the review UI (client), so the
 * `post_review` tool's arguments are the single source of truth: the agent
 * validates them against this schema before posting to GitHub, and the UI
 * renders the review from that same object as it arrives — rather than the
 * model having to emit a second, independently-derived copy.
 *
 * Must stay free of server-only imports: this module is bundled for the
 * browser.
 */
import { z } from "zod";

export const severitySchema = z.enum(["critical", "warning", "suggestion", "praise"]);
export type Severity = z.infer<typeof severitySchema>;

export const reviewCommentSchema = z.object({
  path: z.string().describe("File path relative to the repository root"),
  line: z.number().int().positive().describe("Line number in the new version of the file"),
  severity: severitySchema,
  title: z.string().describe("Short headline for the comment"),
  body: z.string().describe("Markdown body of the inline comment"),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

export const postReviewArgsSchema = z.object({
  summary: z
    .string()
    .describe("Markdown summary of the review — strengths, concerns, and an overall verdict."),
  comments: z.array(reviewCommentSchema).describe("Inline comments to attach to specific lines"),
});
export type PostReviewArgs = z.infer<typeof postReviewArgsSchema>;

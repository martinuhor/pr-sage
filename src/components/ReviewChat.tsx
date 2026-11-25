"use client";

/**
 * ReviewChat component
 *
 * Uses the AI SDK's useObject hook to consume the streaming structured review
 * from /api/review. Renders live-updating review comments and summary
 * as the agent works through the PR.
 */
import { useObject } from "@ai-sdk/react";
import { useState } from "react";
import { z } from "zod";
import { CommentCard } from "./CommentCard";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";
import { Loader2, GitPullRequest, Sparkles, ExternalLink } from "lucide-react";

interface ReviewChatProps {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
}

const commentSchema = z.object({
  path: z.string(),
  line: z.number(),
  severity: z.enum(["critical", "warning", "suggestion", "praise"]),
  title: z.string(),
  body: z.string(),
});

// Mirrors the Output.object schema streamed by src/lib/agent/reviewer.ts.
const reviewSchema = z.object({
  status: z.enum(["analyzing", "reviewing", "posting", "done"]),
  progress: z.string(),
  summary: z.string().optional(),
  comments: z.array(commentSchema).optional(),
  reviewUrl: z.string().optional(),
});

type Comment = z.infer<typeof commentSchema>;

export function ReviewChat({ owner, repo, prNumber, prTitle }: ReviewChatProps) {
  const [started, setStarted] = useState(false);

  const { object: review, submit, isLoading, error, clear } = useObject({
    api: "/api/review",
    schema: reviewSchema,
  });

  // Render a comment card only once every field has streamed in, so partial
  // objects never produce half-empty cards.
  const comments = (review?.comments ?? []).filter(
    (c): c is Comment =>
      Boolean(c?.path && c.line && c.severity && c.title && c.body)
  );

  const handleStartReview = () => {
    setStarted(true);
    clear();
    submit({ owner, repo, prNumber });
  };

  const criticalCount = comments.filter((c) => c.severity === "critical").length;
  const warningCount = comments.filter((c) => c.severity === "warning").length;

  return (
    <div className="space-y-6">
      {/* PR Header */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
        <GitPullRequest className="w-5 h-5 text-violet-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium text-zinc-100 truncate">{prTitle}</p>
          <p className="text-sm text-zinc-500">
            {owner}/{repo} #{prNumber}
          </p>
        </div>
      </div>

      {/* Start button */}
      {!started && (
        <button
          onClick={handleStartReview}
          className={cn(
            "w-full py-3 px-6 rounded-xl font-semibold text-sm",
            "bg-violet-600 hover:bg-violet-500 text-white",
            "transition-all duration-200 flex items-center justify-center gap-2",
            "shadow-lg shadow-violet-900/30"
          )}
        >
          <Sparkles className="w-4 h-4" />
          Start AI Review
        </button>
      )}

      {/* Live status */}
      {started && (
        <div className="space-y-4">
          {/* Progress */}
          <div className="flex items-center gap-3 text-sm">
            {isLoading && (
              <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
            )}
            {review?.status && <StatusBadge status={review.status} />}
            {review?.progress && (
              <span className={cn("text-zinc-400", isLoading && "streaming-cursor")}>
                {review.progress}
              </span>
            )}
          </div>

          {/* Stats strip */}
          {comments.length > 0 && (
            <div className="flex gap-3 text-xs font-medium">
              {criticalCount > 0 && (
                <span className="px-2 py-1 rounded-md bg-red-950/50 text-red-400 border border-red-900">
                  {criticalCount} critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="px-2 py-1 rounded-md bg-amber-950/50 text-amber-400 border border-amber-900">
                  {warningCount} warning
                </span>
              )}
              <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
                {comments.length} total
              </span>
            </div>
          )}

          {/* Summary */}
          {review?.summary && (
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-300">Summary</h3>
              <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
                {review.summary}
              </p>
            </div>
          )}

          {/* Inline comments */}
          {comments.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-zinc-300">Inline Comments</h3>
              {comments.map((comment, i) => (
                <CommentCard key={i} comment={comment} />
              ))}
            </div>
          )}

          {/* Review link */}
          {review?.reviewUrl && (
            <a
              href={review.reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View full review on GitHub
            </a>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 rounded-xl border border-red-900 bg-red-950/30 text-red-400 text-sm">
              Error: {error.message}
            </div>
          )}

          {/* The stream can end without a single JSON chunk if the model call
              fails mid-stream (e.g. a Gateway error after the response has
              already started). Without this the panel renders as an empty
              void, since every other branch is gated on `review`. */}
          {!isLoading && !review && !error && (
            <div className="p-4 rounded-xl border border-amber-900 bg-amber-950/20 text-amber-400 text-sm">
              The review returned no output. That usually means the model call failed — check the
              function logs for a Gateway or provider error.
            </div>
          )}

          {/* Restart button once done */}
          {review?.status === "done" && (
            <button
              onClick={() => {
                setStarted(false);
                clear();
              }}
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors underline underline-offset-2"
            >
              Run another review
            </button>
          )}
        </div>
      )}
    </div>
  );
}

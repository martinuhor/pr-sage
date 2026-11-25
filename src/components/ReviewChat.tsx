"use client";

/**
 * ReviewChat
 *
 * Consumes the agent's UI message stream from /api/review with `useChat`.
 * Every value rendered here is derived from that stream:
 *
 *   - the activity log is built from the tool-call parts the agent emits, so
 *     it shows what the agent actually did rather than a status string the
 *     model was asked to narrate about itself
 *   - the review (summary + inline comments) is read from the `post_review`
 *     tool call's arguments — the same payload that was posted to GitHub,
 *     validated with the same schema the server used
 *   - the review URL is read from that tool call's result
 */
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useMemo, useState } from "react";
import { CommentCard } from "./CommentCard";
import { StatusBadge } from "./StatusBadge";
import { postReviewArgsSchema } from "@/lib/agent/review-schema";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Sparkles,
} from "lucide-react";

interface ReviewChatProps {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
}

type Phase = "analyzing" | "reviewing" | "posting" | "done";

/** A tool invocation pulled out of a message part. */
interface ToolActivity {
  name: string;
  state: string;
  input: unknown;
  output: unknown;
  errorText?: string;
}

type MessagePart = UIMessage["parts"][number];

function readActivity(part: MessagePart): ToolActivity | null {
  if (part.type === "dynamic-tool") {
    const p = part as unknown as {
      toolName?: string;
      state?: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };
    return {
      name: p.toolName ?? "tool",
      state: p.state ?? "unknown",
      input: p.input,
      output: p.output,
      errorText: p.errorText,
    };
  }

  if (part.type.startsWith("tool-")) {
    // Static tool parts are keyed by name: `tool-fetch_pr_files`, etc.
    const p = part as unknown as {
      type: string;
      state?: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };
    return {
      name: p.type.slice("tool-".length),
      state: p.state ?? "unknown",
      input: p.input,
      output: p.output,
      errorText: p.errorText,
    };
  }

  return null;
}

function isSettled(state: string) {
  return state === "output-available" || state === "output-error";
}

function describeActivity(a: ToolActivity): string {
  if (a.name === "fetch_pr_files") {
    const out = a.output as { total?: number } | undefined;
    if (a.state === "output-available" && typeof out?.total === "number") {
      return `Fetched ${out.total} changed file${out.total === 1 ? "" : "s"}`;
    }
    return "Fetching changed files";
  }

  if (a.name === "read_file_context") {
    const input = a.input as { path?: string } | undefined;
    const out = a.output as { startLine?: number; endLine?: number } | undefined;
    const path = input?.path ?? "file";
    if (a.state === "output-available" && out?.startLine && out?.endLine) {
      return `Read ${path} (lines ${out.startLine}–${out.endLine})`;
    }
    return `Reading ${path}`;
  }

  if (a.name === "post_review") {
    if (a.state === "output-available") return "Posted review to GitHub";
    if (a.state === "output-error") return "Failed to post the review";
    return "Composing review";
  }

  return a.name;
}

export function ReviewChat({ owner, repo, prNumber, prTitle }: ReviewChatProps) {
  const [started, setStarted] = useState(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/review", body: { owner, repo, prNumber } }),
    [owner, repo, prNumber]
  );

  const { messages, sendMessage, status, error, setMessages, clearError } = useChat({ transport });

  const isStreaming = status === "submitted" || status === "streaming";

  const activities = useMemo(
    () =>
      messages
        .filter((m) => m.role === "assistant")
        .flatMap((m) => m.parts.map(readActivity))
        .filter((a): a is ToolActivity => a !== null),
    [messages]
  );

  // The post_review call *is* the review. Its arguments are parsed with the
  // same schema the server validated before posting to GitHub, so the cards on
  // screen describe exactly what landed in the PR.
  const reviewActivity = useMemo(
    () => [...activities].reverse().find((a) => a.name === "post_review"),
    [activities]
  );

  const parsedReview = useMemo(() => {
    if (!reviewActivity || reviewActivity.state === "input-streaming") return null;
    const parsed = postReviewArgsSchema.safeParse(reviewActivity.input);
    return parsed.success ? parsed.data : null;
  }, [reviewActivity]);

  const comments = parsedReview?.comments ?? [];

  const reviewUrl = useMemo(() => {
    const out = reviewActivity?.output;
    if (out && typeof out === "object" && "reviewUrl" in out) {
      return String((out as { reviewUrl: unknown }).reviewUrl);
    }
    return undefined;
  }, [reviewActivity]);

  const phase: Phase = useMemo(() => {
    if (reviewActivity) {
      return reviewActivity.state === "output-available" ? "done" : "posting";
    }
    return activities.some((a) => a.name === "read_file_context") ? "reviewing" : "analyzing";
  }, [activities, reviewActivity]);

  const criticalCount = comments.filter((c) => c.severity === "critical").length;
  const warningCount = comments.filter((c) => c.severity === "warning").length;

  const latest = activities[activities.length - 1];
  const reviewFailed = reviewActivity?.state === "output-error";

  const handleStartReview = () => {
    setStarted(true);
    clearError();
    setMessages([]);
    void sendMessage({ text: `Review PR #${prNumber} in ${owner}/${repo}` });
  };

  const handleReset = () => {
    setStarted(false);
    clearError();
    setMessages([]);
  };

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

      {started && (
        <div className="space-y-4">
          {/* Live status */}
          <div className="flex items-center gap-3 text-sm">
            {isStreaming && <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />}
            <StatusBadge status={phase} />
            {isStreaming && latest && (
              <span className="text-zinc-400 truncate">{describeActivity(latest)}</span>
            )}
          </div>

          {/* Activity log — one line per tool call the agent actually made */}
          {activities.length > 0 && (
            <ol className="space-y-1.5 text-xs">
              {activities.map((activity, i) => (
                <li key={i} className="flex items-center gap-2 text-zinc-500">
                  {activity.state === "output-error" ? (
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  ) : isSettled(activity.state) ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/80 shrink-0" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
                  )}
                  <span className={cn("font-mono", isSettled(activity.state) && "text-zinc-600")}>
                    {describeActivity(activity)}
                  </span>
                </li>
              ))}
            </ol>
          )}

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
          {parsedReview?.summary && (
            <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-300">Summary</h3>
              <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-wrap">
                {parsedReview.summary}
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
          {reviewUrl && (
            <a
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-violet-400 hover:text-violet-300 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              View full review on GitHub
            </a>
          )}

          {/* Stream error — surfaced verbatim by the route's onError handler */}
          {error && (
            <div className="p-4 rounded-xl border border-red-900 bg-red-950/30 text-red-400 text-sm space-y-1">
              <p className="font-medium">The review failed</p>
              <p className="text-red-300/80 break-words">{error.message}</p>
            </div>
          )}

          {/* post_review itself failed — the model's tool call was rejected or
              the GitHub API rejected it. */}
          {reviewFailed && !error && (
            <div className="p-4 rounded-xl border border-red-900 bg-red-950/30 text-red-400 text-sm space-y-1">
              <p className="font-medium">The review could not be posted to GitHub</p>
              <p className="text-red-300/80 break-words">
                {reviewActivity?.errorText ?? "No error detail was returned."}
              </p>
            </div>
          )}

          {/* The stream can end without a review if the model never calls
              post_review (for example it hit the step limit). Without this the
              panel would look like it simply stopped. */}
          {!isStreaming && !parsedReview && !error && !reviewFailed && (
            <div className="p-4 rounded-xl border border-amber-900 bg-amber-950/20 text-amber-400 text-sm">
              The agent finished without posting a review. That usually means it ran out of tool
              steps before reaching <span className="font-mono">post_review</span>.
            </div>
          )}

          {/* Reset once the run is over */}
          {!isStreaming && (
            <button
              onClick={handleReset}
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

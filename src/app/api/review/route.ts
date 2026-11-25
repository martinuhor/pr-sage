/**
 * POST /api/review
 *
 * Starts a streaming AI review of a GitHub PR.
 *
 * Returns the agent's UI message stream (`toUIMessageStream`) — the protocol
 * the AI SDK's `useChat` hook consumes. That stream carries the model's text,
 * every tool call the agent makes, and each tool's result, so the client can
 * render real progress and the final review without the server describing
 * either one separately.
 *
 * Request body (extra fields are ignored):
 *   { owner, repo, prNumber, focusAreas? }
 */
import { NextRequest } from "next/server";
import { createUIMessageStreamResponse, toUIMessageStream } from "ai";
import { streamPRReview } from "@/lib/agent/reviewer";
import { parseRepoInput } from "@/lib/github/parse-repo";
import { metric } from "@vercel/functions";

export const runtime = "nodejs"; // Stay on Node.js — Fluid Compute handles concurrency

// Allow long-running reviews (Vercel Functions default is 300s on Fluid Compute)
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    owner: rawOwner,
    repo: rawRepo,
    prNumber,
    focusAreas,
    installationId,
  } = body as {
    owner: string;
    repo: string;
    prNumber: number;
    focusAreas?: string[];
    installationId?: number;
  };

  if (!rawOwner || !rawRepo || !prNumber) {
    return new Response(JSON.stringify({ error: "owner, repo, and prNumber are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { owner, repo } = parseRepoInput(rawOwner, rawRepo);

  metric("api.review.request", 1, { repo });

  try {
    const result = await streamPRReview({ owner, repo, prNumber, focusAreas, installationId });

    const stream = toUIMessageStream({
      stream: result.stream,
      // The SDK masks stream errors as "An error occurred." by default, which
      // leaves the client unable to tell a Gateway auth failure from a network
      // blip. Surface the real reason — it is the difference between a user
      // retrying and a user fixing their configuration.
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });

    return createUIMessageStreamResponse({ stream });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    metric("api.review.error", 1, { repo, error: message.slice(0, 64) });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

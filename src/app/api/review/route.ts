/**
 * POST /api/review
 *
 * Starts a streaming AI review of a GitHub PR.
 * Returns a UI message stream compatible with the AI SDK's useChat hook.
 *
 * Request body:
 *   { owner, repo, prNumber, focusAreas? }
 *
 * The response is a chunked stream of UI message parts.
 * Each chunk updates the in-progress review state on the client.
 */
import { NextRequest } from "next/server";
import { createUIMessageStreamResponse } from "ai";
import { streamPRReview } from "@/lib/agent/reviewer";
import { metric } from "@vercel/functions";

export const runtime = "nodejs"; // Stay on Node.js — Fluid Compute handles concurrency

// Allow long-running reviews (Vercel Functions default is 300s on Fluid Compute)
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { owner, repo, prNumber, focusAreas, installationId } = body as {
    owner: string;
    repo: string;
    prNumber: number;
    focusAreas?: string[];
    installationId?: number;
  };

  if (!owner || !repo || !prNumber) {
    return new Response(JSON.stringify({ error: "owner, repo, and prNumber are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  metric("api.review.request", 1, { repo });

  try {
    const reviewStream = await streamPRReview({ owner, repo, prNumber, focusAreas, installationId });

    // toUIMessageStreamResponse() sends the stream in the AI SDK UI protocol
    // so useChat() on the client can consume it natively.
    return reviewStream.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    metric("api.review.error", 1, { repo, error: message.slice(0, 64) });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * POST /api/review
 *
 * Starts a streaming AI review of a GitHub PR.
 * Streams the structured review as chunked JSON text, consumed by the
 * AI SDK's useObject hook on the client.
 *
 * Request body:
 *   { owner, repo, prNumber, focusAreas? }
 *
 * Each chunk is a partial JSON object, so the client can render the
 * in-progress review state as the agent works.
 */
import { NextRequest } from "next/server";
import { streamPRReview } from "@/lib/agent/reviewer";
import { metric } from "@vercel/functions";

export const runtime = "nodejs"; // Stay on Node.js — Fluid Compute handles concurrency

// Allow long-running reviews (Vercel Functions default is 300s on Fluid Compute)
export const maxDuration = 300;

/**
 * Accepts "repo", "owner/repo", or a full GitHub URL, so a link pasted into the
 * form still resolves to the right repository.
 */
function parseRepoInput(inputOwner: string, inputRepo: string): { owner: string; repo: string } {
  const cleaned = inputRepo.trim().replace(/\.git$/, "").replace(/\/+$/, "");

  const url = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (url) return { owner: url[1], repo: url[2] };

  const pair = cleaned.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (pair) return { owner: pair[1], repo: pair[2] };

  return { owner: inputOwner.trim(), repo: cleaned };
}

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
    const reviewStream = await streamPRReview({ owner, repo, prNumber, focusAreas, installationId });

    // toTextStreamResponse() streams the structured output as a chunked JSON
    // text stream, which is the protocol useObject() on the client consumes.
    return reviewStream.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    metric("api.review.error", 1, { repo, error: message.slice(0, 64) });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

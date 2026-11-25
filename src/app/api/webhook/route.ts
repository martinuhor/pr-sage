/**
 * POST /api/webhook/github
 *
 * Receives GitHub App webhook events and triggers AI reviews automatically
 * when a PR is opened, reopened, or marked ready for review.
 *
 * Security: validates the HMAC-SHA256 signature using GITHUB_WEBHOOK_SECRET.
 */
import { NextRequest } from "next/server";
import { Webhooks } from "@octokit/webhooks";
import { streamPRReview } from "@/lib/agent/reviewer";
import { metric } from "@vercel/functions";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Constructed per-request so the build doesn't require GITHUB_WEBHOOK_SECRET,
  // and so the secret is read at runtime rather than at module load.
  const webhooks = new Webhooks({
    secret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
  });

  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const event = req.headers.get("x-github-event") ?? "";

  // Verify webhook signature
  const isValid = await webhooks.verify(body, signature);
  if (!isValid) {
    metric("webhook.invalid_signature", 1);
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(body);

  // Only handle pull_request events that need a review
  if (event !== "pull_request") {
    return new Response("OK", { status: 200 });
  }

  const { action, pull_request: pr, repository, installation } = payload;

  if (!["opened", "reopened", "ready_for_review"].includes(action)) {
    return new Response("OK", { status: 200 });
  }

  if (pr.draft) {
    return new Response("Skipping draft PR", { status: 200 });
  }

  metric("webhook.pr_review_triggered", 1, {
    repo: repository.full_name,
    action,
  });

  // Fire-and-forget: don't await the full review — webhook must respond in <10s
  // The review runs on Fluid Compute and streams to completion independently.
  void (async () => {
    try {
      const reviewStream = await streamPRReview({
        owner: repository.owner.login,
        repo: repository.name,
        prNumber: pr.number,
        installationId: installation?.id,
      });

      // Drain the stream to completion (posts GitHub review at the end via tool)
      for await (const _ of reviewStream.fullStream) { void _; }

      metric("webhook.review_complete", 1, { repo: repository.full_name });
    } catch (err) {
      metric("webhook.review_error", 1, {
        repo: repository.full_name,
        error: err instanceof Error ? err.message.slice(0, 64) : "unknown",
      });
    }
  })();

  return new Response("Review triggered", { status: 202 });
}

/**
 * GET /api/digest
 *
 * Nightly review digest — triggered by Vercel Schedules (see vercel.ts).
 * Runs at 07:00 UTC every day.
 *
 * In a real app, this would query your database for recent reviews
 * and send a Slack / email summary. For now it emits a metric and logs
 * a summary.
 */
import { handleSchedule } from "@vercel/schedules";
import { metric } from "@vercel/functions";

export const runtime = "nodejs";
export const maxDuration = 60;

// handleSchedule verifies the Vercel schedule signature and returns 405 for
// non-schedule requests in production, keeping the endpoint private.
export const GET = handleSchedule(async () => {
  metric("digest.run", 1);

  // This endpoint is a stub: it emits a metric and a log line. Wiring it to a
  // real digest means querying a review store for the last 24h and fanning out
  // to a notification channel — neither of which is implemented yet.
  const summary = {
    at: new Date().toISOString(),
    message: "Nightly PR Sage digest — integrate your storage layer here.",
  };

  console.log(summary.at, summary.message);
});

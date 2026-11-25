/**
 * GET /api/digest
 *
 * Nightly review digest — triggered by Vercel Schedules (see vercel.ts).
 * Runs at 07:00 UTC every day.
 *
 * In a real app, this would query your database for recent reviews
 * and send a Slack / email summary. For now it emits metrics and
 * returns a JSON summary.
 */
import { NextRequest } from "next/server";
import { handleSchedule } from "@vercel/schedules";
import { metric } from "@vercel/functions";

export const runtime = "nodejs";
export const maxDuration = 60;

async function runDigest() {
  metric("digest.run", 1);

  // In production: query Vercel Blob / Postgres for all reviews in last 24h
  // and send a Slack message via the slack channel tool.
  const summary = {
    at: new Date().toISOString(),
    message: "Nightly PR Sage digest — integrate your storage layer here.",
  };

  return Response.json(summary);
}

export function GET(req: NextRequest) {
  // handleSchedule verifies the Vercel cron signature and returns 405 for
  // non-cron requests in production, keeping the endpoint private.
  return handleSchedule(req, runDigest);
}

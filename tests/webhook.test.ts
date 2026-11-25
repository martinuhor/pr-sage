/**
 * Signature verification on the GitHub App webhook.
 *
 * Regression tests for a production bug: @octokit/webhooks `verify()` *throws*
 * on a missing or malformed signature rather than returning false, so the
 * `if (!isValid)` guard was unreachable and an unsigned request produced a 500
 * instead of a 401. Anything that isn't a valid signature must stay a 401.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/webhook/route";

const SECRET = "test-webhook-secret";
const WRONG_SECRET = "not-the-webhook-secret";

function sign(raw: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

async function post(
  body: unknown,
  options: { event?: string; signature?: string | null } = {}
): Promise<Response> {
  const raw = JSON.stringify(body);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.event !== undefined) headers.set("x-github-event", options.event);
  if (options.signature !== null) headers.set("x-hub-signature-256", options.signature ?? sign(raw));

  return POST(
    new NextRequest("https://pr-sage.test/api/webhook", { method: "POST", body: raw, headers })
  );
}

function payload(options: { action?: string; draft?: boolean } = {}) {
  return {
    action: options.action ?? "opened",
    pull_request: {
      number: 7,
      draft: options.draft ?? false,
      title: "Add pagination",
      body: null,
      head: { ref: "feature", sha: "abc123" },
      base: { ref: "main" },
    },
    repository: { name: "widgets", full_name: "acme/widgets", owner: { login: "acme" } },
    installation: { id: 123 },
  };
}

const savedAppId = process.env.GITHUB_APP_ID;
const savedPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

before(() => {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  // Keep the fire-and-forget review deterministic: with no App credentials it
  // fails immediately inside its own try/catch instead of reaching GitHub.
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
});

after(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  if (savedAppId !== undefined) process.env.GITHUB_APP_ID = savedAppId;
  if (savedPrivateKey !== undefined) process.env.GITHUB_APP_PRIVATE_KEY = savedPrivateKey;
});

test("rejects a request with no signature header", async () => {
  const response = await post(payload(), { event: "pull_request", signature: null });
  assert.equal(response.status, 401);
});

test("rejects a malformed signature header", async () => {
  const response = await post(payload(), { event: "pull_request", signature: "sha256=not-hex" });
  assert.equal(response.status, 401);
});

test("rejects a signature made with the wrong secret", async () => {
  const raw = JSON.stringify(payload());
  const response = await post(payload(), { event: "pull_request", signature: sign(raw, WRONG_SECRET) });
  assert.equal(response.status, 401);
});

test("ignores non-pull_request events", async () => {
  const response = await post({ zen: "Keep it logically awesome." }, { event: "ping" });
  assert.equal(response.status, 200);
});

test("ignores pull_request actions that don't need a review", async () => {
  const response = await post(payload({ action: "closed" }), { event: "pull_request" });
  assert.equal(response.status, 200);
});

test("skips draft pull requests", async () => {
  const response = await post(payload({ draft: true }), { event: "pull_request" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "Skipping draft PR");
});

test("triggers a review for an opened pull request", async () => {
  const response = await post(payload({ action: "opened" }), { event: "pull_request" });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "Review triggered");
});

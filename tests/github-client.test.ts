/**
 * GitHub App authentication.
 *
 * Regression tests for a production bug: repository endpoints need an
 * installation token, and handing @octokit/auth-app an `installationId` of
 * `undefined` throws "installationId option is required for installation
 * authentication". `getPullRequest` must therefore resolve the installation
 * first when the caller doesn't already know it — the web UI never does.
 *
 * A local HTTP server stands in for api.github.com, so the App JWT →
 * installation-token exchange is exercised for real without touching GitHub.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type ServerResponse } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { getPullRequest, resolveInstallationId } from "@/lib/github/client";

/** Distinct installation per repo, so each test's token exchange is a fresh request. */
const INSTALLATIONS: Record<string, number> = { widgets: 1001, gadgets: 1002 };

interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
}

const requests: RecordedRequest[] = [];
let server: Server;

function respond(status: number, body: unknown, res: ServerResponse) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const savedEnv = {
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  GITHUB_API_BASE_URL: process.env.GITHUB_API_BASE_URL,
};

before(async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  process.env.GITHUB_APP_ID = "123456";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;

  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const method = req.method ?? "";
    requests.push({ method, path, authorization: req.headers.authorization });

    const installation = path.match(/^\/repos\/[^/]+\/([^/]+)\/installation$/);
    if (method === "GET" && installation) {
      const id = INSTALLATIONS[installation[1]];
      if (id === undefined) return respond(404, { message: "no installation" }, res);
      return respond(200, { id, account: { login: "acme" } }, res);
    }

    const token = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (method === "POST" && token) {
      return respond(
        201,
        {
          token: `ghs_token_${token[1]}`,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: { contents: "read", pull_requests: "write" },
          repository_selection: "all",
        },
        res
      );
    }

    const pull = path.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/);
    if (method === "GET" && pull) {
      return respond(
        200,
        {
          number: Number(pull[3]),
          title: "Add pagination",
          body: null,
          state: "open",
          draft: false,
          head: { ref: "feature", sha: "abc123" },
          base: { ref: "main" },
          user: { login: "octocat", avatar_url: "" },
          html_url: "https://github.com/acme/widgets/pull/7",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          additions: 12,
          deletions: 3,
          changed_files: 1,
          mergeable: true,
        },
        res
      );
    }

    respond(404, { message: `unexpected request ${method} ${path}` }, res);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server has no port");
  process.env.GITHUB_API_BASE_URL = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("resolves an installation with the App JWT", async () => {
  requests.length = 0;

  const installationId = await resolveInstallationId("acme", "widgets");

  assert.equal(installationId, 1001);
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    ["GET /repos/acme/widgets/installation"]
  );
  // Signed with a short-lived App JWT, not an installation token.
  assert.match(requests[0].authorization ?? "", /^bearer eyJ/i);
});

test("getPullRequest works when the caller doesn't know the installationId", async () => {
  requests.length = 0;

  const pullRequest = await getPullRequest("acme", "widgets", 7);

  assert.equal(pullRequest.number, 7);
  assert.equal(pullRequest.title, "Add pagination");
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /repos/acme/widgets/installation",
      "POST /app/installations/1001/access_tokens",
      "GET /repos/acme/widgets/pulls/7",
    ]
  );
  // The PR itself is read with the installation token, not the App JWT.
  assert.equal(requests[2].authorization?.toLowerCase(), "token ghs_token_1001");
});

test("skips the installation lookup when an installationId is supplied", async () => {
  requests.length = 0;

  await getPullRequest("acme", "gadgets", 7, 1002);

  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.path}`),
    ["POST /app/installations/1002/access_tokens", "GET /repos/acme/gadgets/pulls/7"]
  );
});

test("fails loudly when App credentials are missing", async () => {
  const appId = process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_ID;

  try {
    await assert.rejects(
      () => getPullRequest("acme", "widgets", 7),
      /GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set/
    );
  } finally {
    if (appId !== undefined) process.env.GITHUB_APP_ID = appId;
  }
});

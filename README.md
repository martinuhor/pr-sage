# PR Sage

**AI code review agent for GitHub pull requests.** It reads a PR's diff, decides what else it needs
to read, and posts a severity-tagged review — as inline comments on the diff — while streaming its
progress to a browser in real time.

Built on the Vercel AI SDK 7 and the Vercel AI Gateway (no provider API keys in code), with GitHub
App authentication and HMAC-verified webhooks.

**[Live app](https://pr-sage-blush.vercel.app)** · **[Project page](https://martinuhor.github.io/pr-sage/)** · `/review?owner=<owner>&repo=<repo>&pr=<number>`

---

## What it does

1. **Reviews PRs automatically** — installed as a GitHub App. When a PR is opened, reopened, or
   marked ready for review, a webhook starts a review with no human involved.
2. **Reviews on demand from the browser** — `/review` takes an owner/repo/PR number, runs the same
   agent, and streams the run as it happens.
3. **Posts inline comments** — findings land on specific diff lines on GitHub, tagged
   `critical` / `warning` / `suggestion` / `praise`, with a markdown summary body.
4. **Emits metrics and structured logs** — token spend, per-step latency and tool usage per review.

The nightly digest endpoint (`/api/digest`, fired by a Vercel Schedule at 07:00 UTC) is a **stub** —
see [Known gaps](#known-gaps).

## Architecture

```
  GitHub PR opened ──webhook (HMAC-SHA256)──▶ /api/webhook
                                                 │ verify signature
                                                 │ 202 Accepted, fire-and-forget
                                                 ▼
  browser ──/review?owner&repo&pr──▶ /api/review ──▶ streamPRReview()
                                                      │            ▲
                                                      │            └── PrDataSource
                            streamText(model, tools,   │                (GitHub API in prod,
                            stopWhen: isStepCount(10)) │                 fixture PR in evals)
                                                      │
                              ┌───────────────────────┼───────────────────────┐
                              ▼                       ▼                       ▼
                     fetch_pr_files          read_file_context           post_review
                     changed files +          head-branch file            createReview:
                     patches                  content, paged              inline comments + body
                              │                       │                       │
                              └───────────────────────┴───────────────────────┘
                                                      │
                                    UI message stream (toUIMessageStream)
                                                      ▼
                              activity log + comment cards, both derived
                              from the tool calls in that stream
```

One review path exists. `/api/webhook` and `/api/review` differ only in how the request arrives and
whether the stream is drained server-side or forwarded to a browser; both call
[`streamPRReview`](file:///Users/mac/Desktop/vercel%20project/pr-sage/src/lib/agent/reviewer.ts#L197-L303).

## Design decisions

### The `post_review` tool call is the single source of truth

The agent has exactly one way to express a review: the arguments of its `post_review` tool call,
validated against [`postReviewArgsSchema`](file:///Users/mac/Desktop/vercel%20project/pr-sage/src/lib/agent/review-schema.ts).
That payload is what gets posted to GitHub.

The browser renders from the *same* tool-call payload as it streams in — not a second copy that the
model is asked to produce separately. This removes an entire failure mode: a structured output
object drifting out of sync with what was actually posted. The schema module is shared by both sides
and is kept free of server-only imports so it can be bundled for the browser.

The eval harness asserts this property (`consistency`) rather than assuming it: for every fixture it
rebuilds the expected comment body and compares it to what `postReviewComment` actually received.

### Progress is derived, not narrated

There is no `status` field in the agent's output and no progress-oriented prompt. The activity log in
[`ReviewChat`](file:///Users/mac/Desktop/vercel%20project/pr-sage/src/components/ReviewChat.tsx) is
built from the tool-call parts the SDK emits, so it reports what the agent did rather than what the
agent said it was doing. A step that never happened cannot appear in the log.

### A tool loop, not prompt engineering

Each tool does one thing and the model decides when to call it. `fetch_pr_files` truncates patches at
4000 characters per file and reports which files lost their tail (`patchesTruncated`) — rather than
silently handing the model a partial diff and letting it believe the diff is complete.
`read_file_context` pages through whole file content so the model can read past a truncated patch
instead of guessing. The loop is bounded by `stopWhen: isStepCount(10)`.

`temperature: 0.2` and `maxRetries: 2`: a review should not read differently run to run, and
transient provider failures should not kill a run.

### Installation tokens, not just an App JWT

An App JWT can read `/app/*` endpoints but **not** repository endpoints — those need an installation
token. `getPullRequest` therefore resolves the installation ID via
`GET /repos/{owner}/{repo}/installation` when the caller doesn't already know it, which the web UI
never does. Passing `installationId: undefined` through to `@octokit/auth-app` throws at request
time; that is what
[`resolveInstallationId`](file:///Users/mac/Desktop/vercel%20project/pr-sage/src/lib/github/client.ts#L63-L78)
exists to prevent. `tests/github-client.test.ts` asserts the whole exchange, including that the PR
read uses the installation token rather than the App JWT.

### Webhooks answer fast and drain in the background

GitHub times webhooks out at 10 seconds; a full review takes far longer. The route verifies the
signature, returns `202`, and runs the review in a detached task that drains the stream to completion
— `post_review` fires at the end of the stream, so draining it *is* the review.

Signature verification is wrapped in a `try`/`catch` because `@octokit/webhooks` **throws** on a
missing or malformed signature instead of returning `false`. Without the guard, an unsigned request
took down the route with a 500 instead of returning 401 — a small bug with an outsized blast radius.

### Node.js runtime, not Edge

Every API route exports `runtime = "nodejs"` with `maxDuration = 300` (60s for the digest). Streaming
works fine on Node.js with Fluid Compute, and Octokit's GitHub App auth needs Node crypto.

### Stream errors are surfaced verbatim

The AI SDK masks stream errors as `"An error occurred."` by default, which makes a Gateway
authentication failure indistinguishable from a network blip on the client. `/api/review` passes an
`onError` that returns the real message, so the browser shows the actual cause — the difference
between a user retrying and a user fixing their configuration.

## Project structure

```
pr-sage/
├── src/
│   ├── app/
│   │   ├── page.tsx                       # Landing page
│   │   ├── review/page.tsx                # /review — form, then the streaming panel
│   │   └── api/
│   │       ├── review/route.ts            # POST — streams a review to the browser
│   │       ├── webhook/route.ts           # POST — GitHub App webhook (HMAC verified)
│   │       └── digest/route.ts            # GET  — Vercel Schedule entry point (stub)
│   ├── components/
│   │   ├── ReviewChat.tsx                 # useChat consumer; activity log + comment cards
│   │   ├── CommentCard.tsx                # One inline comment
│   │   └── StatusBadge.tsx                # Phase indicator
│   └── lib/
│       ├── agent/
│       │   ├── reviewer.ts                # streamPRReview, tools, metrics, PrDataSource
│       │   └── review-schema.ts           # Zod schema shared by agent and browser
│       ├── github/
│       │   ├── client.ts                  # Octokit App auth + the four GitHub calls
│       │   └── parse-repo.ts              # "repo" / "owner/repo" / URL → { owner, repo }
│       └── utils.ts
├── evals/
│   ├── run.ts                             # Eval harness CLI
│   ├── lib/fixtures.ts                    # Fixture loading + patch generation + validation
│   ├── lib/scoring.ts                     # Recall / precision / F1 / severity scoring
│   └── fixtures/01..20/                   # 20 synthetic PRs with planted bugs
├── tests/
│   ├── webhook.test.ts                    # Signature verification and event routing
│   └── github-client.test.ts              # App JWT → installation token exchange
├── docs/                                  # Static project page (GitHub Pages)
├── scripts/render-demo-video.mjs          # Renders docs/demo.mp4 from the page
├── vercel.ts                              # Typed Vercel config + the digest schedule
└── .env.example
```

## Evals

A review agent that "usually finds the bug" is not a claim anyone can check, so the repo scores it.

`evals/fixtures/` holds 20 synthetic PRs. Each one contains **deliberately planted bugs**, and
`fixture.json` records the ground truth: the file, the line, the severity and a category for every
bug. The fixtures span off-by-one errors, null dereferences, stale closures, missing effect cleanup,
float money arithmetic, loose equality, path traversal, floating promises, resource leaks, XSS,
hardcoded secrets, weak randomness, swallowed exceptions, race conditions, N+1 queries, timezone
bugs, prototype pollution and missing authorization.

**The diff is generated, never hand-written.** Each fixture stores a `base/` tree (if the file
already existed) and a `head/` tree, and the harness produces the patch with `structuredPatch`. The
patch the agent sees therefore cannot drift from the file content `read_file_context` returns — the
one drift that would silently make ground-truth line numbers point at the wrong code.
`validateFixture` hard-fails if a planted bug's line is not an added line in the generated patch,
which is the failure mode that would otherwise cap recall forever without anyone noticing.

Each fixture runs through the real `streamPRReview`, with only `PrDataSource` swapped for one backed
by fixture files (`fixtureDataSource`). Same tools, same loop, same `streamText` config, same metrics
— the scores describe the production agent, not a test double.

```bash
npm run eval -- --validate                  # check fixtures + ground truth; makes zero model calls
npm run eval                                # score every fixture with the default model
npm run eval -- --model=openai/gpt-5        # score with a different Gateway model
npm run eval -- --only=pagination,xss       # subset by fixture id substring
npm run eval -- --tolerance=3               # lines of slack when matching a comment to a bug (default 2)
npm run eval -- --min-recall=0.7            # exit non-zero if recall falls below the bar
```

Matching is deliberately lenient about *where* a finding is cited and strict about *whether* it is
real: a comment matches a planted bug if it is on the same file within `±tolerance` lines. Comments
that match nothing are counted as false positives, and near misses (right file, wrong line) are
reported separately — that distinction separates "never saw it" from "cited it loosely".

Per-run output: `recall`, `precision`, `false-positive rate`, `severity accuracy`, token usage and
wall clock, written to `evals/results/<timestamp>-<model>.json` so model runs can be compared.

**No scores are published here yet.** The harness is complete and the fixtures all validate
(`npm run eval -- --validate` → `20 fixtures valid`), but scoring requires AI Gateway access, which
needs a payment method on the account. A scored run is one command away; publishing invented numbers
would defeat the point of having a harness.

## Tests

```bash
npm test        # node --test via tsx
```

Two suites, both covering bugs that actually reached production:

- **`tests/webhook.test.ts`** — an unsigned request is rejected with 401, a malformed signature is
  rejected, a wrong secret is rejected, `ping` and non-review actions are ignored with 200, draft PRs
  are skipped, and a valid `opened` event returns 202.
- **`tests/github-client.test.ts`** — a real `node:http` server stands in for `api.github.com` (via
  `GITHUB_API_BASE_URL`), so the App JWT → installation-token exchange runs for real: the
  installation lookup is signed with the App JWT, the PR read is signed with the installation token,
  supplying an `installationId` skips the lookup, and missing credentials fail loudly.

The webhook suite runs with `--conditions=import` because `@octokit/webhooks-methods` is ESM-only and
the CJS resolver cannot load it.

## Observability

Every step emits a `metric()` from `@vercel/functions`, tagged with the repo:

| Metric | Meaning |
|---|---|
| `api.review.request` / `api.review.error` | Review route traffic and failures |
| `webhook.pr_review_triggered` / `webhook.review_complete` / `webhook.review_error` | Automatic review lifecycle |
| `webhook.invalid_signature` | Rejected webhooks — a spike means a misconfigured secret |
| `agent.tool_call.<name>` | Tool usage by name |
| `agent.step.input_tokens` / `agent.step.output_tokens` / `agent.step.duration_ms` | Per-step cost and latency |
| `review.input_tokens` / `review.output_tokens` / `review.duration_ms` | Per-review cost and latency |
| `review.posted` | Reviews posted, tagged with the critical-comment count |
| `digest.run` | Digest invocations |

`onEnd` also writes one structured log line per review (`event: "review.usage"`) carrying tokens,
cached input tokens, wall-clock duration and the reason the loop stopped — so a single review's spend
stays recoverable from the function logs after the aggregate metric has been rolled up.

## Running locally

Requires Node.js 22+.

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

| Variable | Required | Notes |
|---|---|---|
| `AI_GATEWAY_API_KEY` | Locally | Injected automatically via OIDC on Vercel |
| `GITHUB_APP_ID` | Yes | From your GitHub App |
| `GITHUB_APP_PRIVATE_KEY` | Yes | PEM contents; `\n` escapes are unescaped at read time |
| `GITHUB_WEBHOOK_SECRET` | For webhooks | Must match the App's webhook secret |
| `GITHUB_API_BASE_URL` | Tests only | Points Octokit at a local server |

Then open `http://localhost:3000/review?owner=<owner>&repo=<repo>&pr=<number>` and press
**Start AI Review**. The run streams its tool calls and renders the review from the `post_review`
payload as it arrives.

### Deploying

```bash
vercel link
vercel env pull .env.local
vercel deploy --prod
```

Set the GitHub App's webhook URL to `https://<your-deployment>/api/webhook` and subscribe to
`pull_request` events. The static project page in `docs/` is deployed separately by
`.github/workflows/pages.yml`.

## Known gaps

These are unimplemented, and the README says so rather than implying otherwise:

- **The digest is a stub.** `/api/digest` emits a metric and logs a line. Wiring it up means querying
  a review store for the last 24 hours and fanning out to a notification channel; neither the store
  nor the channel exists.
- **No review persistence.** Reviews are posted to GitHub and streamed to the browser, but nothing is
  stored, so there is no history, no cost attribution over time and nothing for the digest to read.
- **Reads the PR head only.** `read_file_context` fetches content at `pr.head.sha`; it cannot read the
  merge-base, the base branch, or any other ref.
- **No per-PR concurrency control.** Two events for the same PR could start two reviews.
- **`--tolerance` is global.** The line-matching slack is the same for every fixture.

## Tricky bugs, and why

Five things that looked like they should work and didn't. Each one is now covered by a test or a
fixture.

**1. `installationId option is required for installation authentication`**
A GitHub App JWT authenticates the *App*; it cannot read a repository. Repository endpoints need an
installation token, minted from an installation ID that has to be looked up first. The web UI has no
way to know it, so `undefined` reached `@octokit/auth-app` and the request failed. Fix: resolve the
installation with the App JWT, then mint the token. Covered by `tests/github-client.test.ts`.

**2. Webhooks 500'd instead of 401'ing**
`@octokit/webhooks`' `verify()` throws when the signature header is absent — it doesn't return
`false`. The `if (!isValid) return 401` guard was therefore unreachable for exactly the requests it
was written for. Fix: wrap verification in a `try`/`catch` and treat any failure as unauthorized.
Covered by `tests/webhook.test.ts`.

**3. A black screen instead of an error message**
The AI SDK replaces stream errors with `"An error occurred."` by default. The underlying cause was a
Gateway `403 customer_verification_required` arriving mid-stream, so the client rendered a dead panel
with no explanation. Fix: an `onError` on `toUIMessageStream` that returns the real message, plus a
`ReviewChat` branch for "stream ended without a review" so a run that exhausts its step budget cannot
look like it simply stopped.

**4. The review rendered twice, slightly differently**
The agent returned the review as structured output *and* called `post_review`, and the two copies
disagreed. Fix: delete the second copy. `post_review`'s arguments became the only representation of a
review, streamed to the browser as tool-call parts. The eval harness now checks the UI payload and
the posted payload are byte-identical instead of trusting the architecture note.

**5. A route module that refused to build**
`export function parseRepoInput` on `/api/review` broke `tsc` against Next.js's generated route
types: App Router route files may only export a fixed set of names (`GET`, `POST`, `runtime`,
`maxDuration`, …). The helper moved to `src/lib/github/parse-repo.ts`. A compile error rather than a
runtime one, so it cost a build cycle instead of a production incident — the good kind.

Two harness-specific ones are worth noting too: fixtures with hand-written patches would eventually
disagree with the file content the agent reads, so patches are generated from `base/`/`head/` trees
instead; and `tsx` compiles to CJS here, which rejects top-level `await`
(`ERR_REQUIRE_ASYNC_MODULE`) and cannot load the ESM-only `@octokit/webhooks-methods` — hence
`main().catch(…)` in the eval entry point and `--conditions=import` on the test runner.

---

*Built with the [Vercel AI SDK](https://sdk.vercel.ai) · [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) · [Next.js](https://nextjs.org)*

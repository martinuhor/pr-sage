# PR Sage 🧙

**AI-powered pull request reviews**, built on the Vercel AI platform.

> Live-streaming code analysis using the **Vercel AI SDK 7** `ToolLoopAgent`, routed through the **Vercel AI Gateway** (no API keys in code), with **GitHub App integration** for automatic reviews and inline comments.

---

## What it does

1. **Automatic reviews** — install as a GitHub App; PR Sage reviews every new PR automatically
2. **Live streaming UI** — open `/review?owner=&repo=&pr=` to watch the agent analyze in real time
3. **Inline GitHub comments** — posts severity-tagged comments (`critical` / `warning` / `suggestion` / `praise`) directly on the diff
4. **Nightly digest** — a Vercel Schedule fires at 07:00 UTC to summarize recent review activity
5. **Full observability** — every tool call emits a `metric()` to Vercel Custom Metrics

## The stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 App Router + PPR |
| Agent runtime | AI SDK 7 `ToolLoopAgent` + `streamText` |
| Model routing | Vercel AI Gateway (`anthropic/claude-sonnet-4-5`) |
| Durable sessions | eve |
| Scheduling | Vercel Schedules (`handleSchedule`) |
| Storage | Vercel Blob |
| Compute | Fluid Compute (Node.js, 300s max) |
| Observability | Vercel Custom Metrics (`metric()`) |
| Auth | GitHub App + HMAC webhook verification |
| Config | `vercel.ts` (typed Vercel config) |

## Why this architecture is correct

### No API keys in code
Models are referenced as `"anthropic/claude-sonnet-4-5"` strings — the AI Gateway handles auth via OIDC on Vercel deployments, or a single `AI_GATEWAY_API_KEY` locally. No `OPENAI_API_KEY`, no `ANTHROPIC_API_KEY`.

### Streaming first
The `/api/review` route uses `streamText` with `toUIMessageStreamResponse()`, sending the AI SDK's UI message protocol. The client's `useChat` hook with `DefaultChatTransport` consumes this natively — no polling, no websocket setup.

### Tool loop, not prompt engineering
Instead of building a giant prompt, the agent uses tools (`fetch_pr_files`, `read_file_context`, `post_review`) with `stopWhen: isStepCount(10)`. This is the correct AI SDK 7 pattern — not the deprecated `maxSteps`.

### PPR (Partial Pre-Rendering)
The landing page and review page hero are static (served from edge cache). Only the dynamic review chat is streamed from Fluid Compute. Enabled via `experimental.ppr: true` in `next.config.ts`.

### Edge runtime is NOT used
The `runtime` export on each API route is `"nodejs"` — matching the current platform best practice. Streaming works fine on Node.js with Fluid Compute; the Edge runtime is deprecated.

### Webhook security
GitHub webhooks are validated with HMAC-SHA256 (`@octokit/webhooks`) before any processing. The endpoint returns `202 Accepted` immediately and streams the review fire-and-forget, keeping under GitHub's 10s webhook timeout.

## Project structure

```
pr-sage/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout (Geist font, dark theme)
│   │   ├── page.tsx                # Landing page (static shell, PPR)
│   │   ├── review/
│   │   │   └── page.tsx            # Streaming review page
│   │   └── api/
│   │       ├── review/route.ts     # POST — starts agent review stream
│   │       ├── webhook/route.ts    # POST — GitHub App webhook handler
│   │       └── digest/route.ts     # GET  — Vercel Schedule digest
│   ├── components/
│   │   ├── ReviewChat.tsx          # useChat streaming UI
│   │   ├── CommentCard.tsx         # Inline comment display
│   │   └── StatusBadge.tsx         # Agent status indicator
│   └── lib/
│       ├── agent/
│       │   └── reviewer.ts         # ToolLoopAgent definition + tools
│       ├── github/
│       │   └── client.ts           # Octokit GitHub API helpers
│       └── utils.ts                # cn(), formatRelativeTime(), etc.
├── agent/                          # eve agent definition (future)
├── vercel.ts                       # Typed Vercel project config + schedule
├── next.config.ts                  # Next.js config (PPR, images)
├── tailwind.config.js
└── .env.example                    # All required env vars documented
```

## Getting started

### Prerequisites
- Node.js 22+
- A Vercel account (for AI Gateway access)
- A GitHub App ([create one here](https://docs.github.com/en/apps/creating-github-apps))

### Local setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your values
cp .env.example .env.local

# 3. Required env vars in .env.local:
#    AI_GATEWAY_API_KEY=   (from Vercel dashboard > AI Gateway)
#    GITHUB_APP_ID=
#    GITHUB_APP_PRIVATE_KEY=
#    GITHUB_WEBHOOK_SECRET=
#    BLOB_READ_WRITE_TOKEN= (from Vercel Blob store)

# 4. Start dev server
npm run dev
```

### Deploy to Vercel

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Link to your Vercel project
vercel link

# Pull env vars from Vercel
vercel env pull .env.local

# Deploy
vercel deploy --prod
```

After deploying:
1. Set your GitHub App's **webhook URL** to `https://your-deployment.vercel.app/api/webhook/github`
2. Install the GitHub App on your repos
3. Open a PR — PR Sage reviews it automatically

### Trying the UI manually

```
https://your-app.vercel.app/review?owner=vercel&repo=next.js&pr=12345
```

---

## Extending PR Sage

| What to add | Where |
|---|---|
| Multi-model security pass (Gemini) | Add second `streamText` call in `reviewer.ts` |
| Slack notifications | Add `eve` Slack channel in `agent/channels/slack.ts` |
| Review history database | Connect Vercel Blob or Neon Postgres |
| Team dashboard | Add `/dashboard` page with Vercel KV counters |
| PR author exclusions | Add rule to `webhook/route.ts` |
| Cost controls | Add budget in Vercel AI Gateway dashboard |

---

*Built with [Vercel AI SDK](https://sdk.vercel.ai) · [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) · [Next.js](https://nextjs.org)*

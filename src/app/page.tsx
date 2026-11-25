import Link from "next/link";
import { GitPullRequest, Zap, Shield, Clock, ArrowRight, Star } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Live Streaming Reviews",
    description:
      "Powered by Vercel AI SDK 7's streamText with a multi-step tool loop. Watch the agent fetch diffs, page through file context, and reason through your code as it works.",
  },
  {
    icon: Shield,
    title: "Multi-Provider AI Gateway",
    description:
      "The provider is resolved at request time: Vercel AI Gateway by default, or Google AI Studio's free tier via GOOGLE_GENERATIVE_AI_API_KEY. No API keys in code — the Gateway authenticates via OIDC on Vercel.",
  },
  {
    icon: GitPullRequest,
    title: "Native GitHub Integration",
    description:
      "Installs as a GitHub App. Automatically reviews PRs on open and posts inline comments directly on the diff.",
  },
  {
    icon: Clock,
    title: "Nightly Digest",
    description:
      "Vercel Schedules sends a daily summary at 07:00 UTC. Runs privately — no exposed endpoints.",
  },
];

const techStack = [
  { name: "Next.js 15", detail: "App Router" },
  { name: "AI SDK 7", detail: "streamText + tool loop" },
  { name: "AI Gateway / AI Studio", detail: "Provider resolved at runtime" },
  { name: "GitHub App", detail: "Webhook + HMAC verification" },
  { name: "Vercel Schedules", detail: "Nightly digest cron" },
  { name: "Zod", detail: "Typed tool schemas" },
  { name: "Fluid Compute", detail: "Long-running Node.js" },
  { name: "Custom Metrics", detail: "metric() observability" },
];

export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-zinc-800/60 px-4 py-3 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
            <GitPullRequest className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-zinc-100">PR Sage</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a
            href="https://github.com/martinuhor/pr-sage"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            GitHub
          </a>
          <Link
            href="/review"
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
          >
            Try it
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4">
        {/* Hero */}
        <section className="py-20 text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-violet-800 bg-violet-950/40 text-violet-400 text-xs font-medium">
            <Star className="w-3 h-3" />
            Built on the full Vercel AI platform
          </div>

          <h1 className="text-5xl sm:text-7xl font-black tracking-tighter text-balance">
            Code reviews,{" "}
            <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              supercharged
            </span>
          </h1>

          <p className="text-zinc-400 max-w-xl mx-auto text-lg text-balance">
            PR Sage is an AI agent that reviews your pull requests in real time — streaming
            analysis, inline comments, and security checks as the tool loop runs.
          </p>

          <div className="flex items-center justify-center gap-3 pt-2">
            <Link
              href="/review"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold transition-colors shadow-lg shadow-violet-900/30"
            >
              Start reviewing <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="https://github.com/martinuhor/pr-sage"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-zinc-700 hover:border-zinc-600 text-zinc-300 font-semibold transition-colors"
            >
              View source
            </a>
          </div>
        </section>

        {/* Features */}
        <section className="py-12 grid sm:grid-cols-2 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 space-y-3 hover:border-zinc-700 transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-violet-950 border border-violet-800 flex items-center justify-center">
                <f.icon className="w-4.5 h-4.5 text-violet-400" />
              </div>
              <h3 className="font-semibold text-zinc-100">{f.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </section>

        {/* Tech stack */}
        <section className="py-12 border-t border-zinc-800/60 space-y-6">
          <h2 className="text-xl font-bold text-zinc-200">The Stack</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {techStack.map((t) => (
              <div
                key={t.name}
                className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 space-y-1"
              >
                <p className="text-sm font-semibold text-zinc-200">{t.name}</p>
                <p className="text-xs text-zinc-500">{t.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="py-8 border-t border-zinc-800/60 text-center text-xs text-zinc-600">
          Built with the Vercel AI platform · Next.js 15 · AI SDK 7
        </footer>
      </div>
    </main>
  );
}

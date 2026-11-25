/**
 * PR Review page — /review
 *
 * Uses PPR (Partial Pre-Rendering) so the static shell is served instantly
 * from the CDN edge, while the dynamic review chat is streamed from
 * Fluid Compute. This is a great showcase of Next.js 15 + Vercel PPR.
 */
import { Suspense } from "react";
import { ReviewChat } from "@/components/ReviewChat";
import { GitBranch, Shield, Zap } from "lucide-react";

interface ReviewPageProps {
  searchParams: Promise<{ owner?: string; repo?: string; pr?: string }>;
}

// Static hero — served from edge cache
function Hero() {
  return (
    <header className="text-center space-y-4 py-12">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-violet-800 bg-violet-950/40 text-violet-400 text-xs font-medium">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
        </span>
        Powered by Vercel AI Gateway + AI SDK 7
      </div>

      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
        PR Sage
        <span className="text-violet-400">.</span>
      </h1>

      <p className="text-zinc-400 max-w-md mx-auto text-balance">
        Real-time AI code reviews using Claude via Vercel AI Gateway, streamed live with the AI
        SDK's ToolLoopAgent.
      </p>

      <div className="flex items-center justify-center gap-6 text-xs text-zinc-500 pt-2">
        <span className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-violet-400" /> Streams live
        </span>
        <span className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-violet-400" /> No keys in code
        </span>
        <span className="flex items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5 text-violet-400" /> Posts to GitHub
        </span>
      </div>
    </header>
  );
}

// Dynamic review panel — streamed from server
async function ReviewPanel({
  owner,
  repo,
  prNumber,
}: {
  owner: string;
  repo: string;
  prNumber: number;
}) {
  // In a real app, fetch PR title from GitHub here (server component)
  const prTitle = `PR #${prNumber} in ${owner}/${repo}`;

  return (
    <ReviewChat
      owner={owner}
      repo={repo}
      prNumber={prNumber}
      prTitle={prTitle}
    />
  );
}

// Input form for manual PR entry
function PRForm() {
  return (
    <form
      action="/review"
      method="GET"
      className="space-y-4 p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm"
    >
      <h2 className="font-semibold text-zinc-200">Review a Pull Request</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-zinc-500 font-medium">Owner</label>
          <input
            name="owner"
            placeholder="vercel"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500 font-medium">Repository</label>
          <input
            name="repo"
            placeholder="next.js"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-zinc-500 font-medium">PR Number</label>
        <input
          name="pr"
          type="number"
          placeholder="1234"
          className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
        />
      </div>

      <button
        type="submit"
        className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
      >
        Load PR
      </button>
    </form>
  );
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;
  const { owner, repo, pr } = params;
  const prNumber = pr ? parseInt(pr, 10) : NaN;
  const hasValidParams = owner && repo && !isNaN(prNumber);

  return (
    <main className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 pb-16">
        {/* Static — served from edge cache instantly */}
        <Hero />

        <div className="space-y-6">
          {hasValidParams ? (
            /* Dynamic — streamed from Fluid Compute via PPR */
            <Suspense
              fallback={
                <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 text-center text-zinc-500 text-sm animate-pulse">
                  Loading PR details…
                </div>
              }
            >
              <ReviewPanel owner={owner!} repo={repo!} prNumber={prNumber} />
            </Suspense>
          ) : (
            <PRForm />
          )}
        </div>
      </div>
    </main>
  );
}

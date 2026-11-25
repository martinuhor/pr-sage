/**
 * GitHub API client utilities
 * Uses Octokit with GitHub App authentication.
 * Authentication is handled server-side only — never expose tokens to the client.
 */
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

export interface PRFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  patch?: string;
  raw_url: string;
  blob_url: string;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: { login: string; avatar_url: string };
  html_url: string;
  created_at: string;
  updated_at: string;
  additions: number;
  deletions: number;
  changed_files: number;
  mergeable: boolean | null;
}

function getAppCredentials(): { appId: string; privateKey: string } {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set");
  }

  return { appId, privateKey };
}

/**
 * Finds the installation granting this App access to owner/repo.
 * Repository endpoints require an installation token, so callers that weren't
 * handed an installation ID (e.g. a review started from the web UI) need to
 * look it up with the App JWT first.
 */
async function resolveInstallationId(owner: string, repo: string): Promise<number> {
  const { appId, privateKey } = getAppCredentials();
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  });

  const { data } = await appOctokit.request("GET /repos/{owner}/{repo}/installation", {
    owner,
    repo,
  });

  return data.id;
}

async function getOctokit(
  owner: string,
  repo: string,
  installationId?: number
): Promise<Octokit> {
  const { appId, privateKey } = getAppCredentials();
  const resolvedInstallationId = installationId ?? (await resolveInstallationId(owner, repo));

  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId: resolvedInstallationId },
  });
}

export async function getPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  installationId?: number
): Promise<PullRequest> {
  const octokit = await getOctokit(owner, repo, installationId);
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  return data as PullRequest;
}

export async function getPRFiles(
  owner: string,
  repo: string,
  prNumber: number,
  installationId?: number
): Promise<PRFile[]> {
  const octokit = await getOctokit(owner, repo, installationId);
  const files: PRFile[] = [];
  
  for await (const response of octokit.paginate.iterator(
    octokit.pulls.listFiles,
    { owner, repo, pull_number: prNumber, per_page: 100 }
  )) {
    files.push(...(response.data as PRFile[]));
  }
  
  return files;
}

export async function postReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  commitId: string,
  comments: Array<{ path: string; line: number; body: string; side?: "LEFT" | "RIGHT" }>,
  reviewBody: string,
  installationId?: number
): Promise<string> {
  const octokit = await getOctokit(owner, repo, installationId);
  
  const { data } = await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: commitId,
    body: reviewBody,
    event: "COMMENT",
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      body: c.body,
      side: c.side ?? "RIGHT",
    })),
  });
  
  return data.html_url ?? "";
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  installationId?: number
): Promise<string | null> {
  const octokit = await getOctokit(owner, repo, installationId);
  
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    if ("content" in data && data.content) {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
  } catch {
    // File not found or binary — skip
  }
  
  return null;
}

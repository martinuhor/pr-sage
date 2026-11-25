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

function getOctokit(installationId?: number): Octokit {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set");
  }

  if (installationId) {
    return new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey, installationId },
    });
  }

  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey },
  });
}

export async function getPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  installationId?: number
): Promise<PullRequest> {
  const octokit = getOctokit(installationId);
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  return data as PullRequest;
}

export async function getPRFiles(
  owner: string,
  repo: string,
  prNumber: number,
  installationId?: number
): Promise<PRFile[]> {
  const octokit = getOctokit(installationId);
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
  const octokit = getOctokit(installationId);
  
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
  const octokit = getOctokit(installationId);
  
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

/**
 * Accepts "repo", "owner/repo", or a full GitHub URL, so a link pasted into the
 * review form still resolves to the right repository.
 */
export function parseRepoInput(
  inputOwner: string,
  inputRepo: string
): { owner: string; repo: string } {
  const cleaned = inputRepo.trim().replace(/\.git$/, "").replace(/\/+$/, "");

  const url = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (url) return { owner: url[1], repo: url[2] };

  const pair = cleaned.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (pair) return { owner: pair[1], repo: pair[2] };

  return { owner: inputOwner.trim(), repo: cleaned };
}

const GITHUB_PR_URL =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

/** Owner, repo, and number from a GitHub pull request URL. */
export function githubPullRequestUrl(
  url: string,
): { owner: string; repo: string; number: number } | undefined {
  const match = GITHUB_PR_URL.exec(url);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return {
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
  };
}

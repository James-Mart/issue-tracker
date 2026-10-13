import { z } from "zod";
import type { ReviewPrSource } from "../schemas/review-state.js";
import { parseGitHubOrigin, parsePrUrl, runGh } from "./delivery.js";
import { IssueError } from "./errors.js";
import { getOriginRemoteUrl, runGit } from "./git-read.js";
import { runGitWrite } from "./git-write.js";
import { requireProjectWorkspace } from "./project-workspace.js";

const GH_PR_FIELDS =
  "number,url,title,baseRefName,headRefName,headRefOid,isCrossRepository";

const ghPrViewSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().min(1),
  title: z.string().min(1),
  baseRefName: z.string().min(1),
  headRefName: z.string().min(1),
  headRefOid: z.string().min(1),
  isCrossRepository: z.boolean(),
});

export type ResolvedReviewPr = {
  title: string;
  pr: ReviewPrSource;
};

type RepoName = { owner: string; repo: string };

type PrInput = {
  number: number;
  located?: RepoName;
};

/** A PR URL, a bare number, or `owner/repo#N`. */
export function parseReviewPrInput(raw: string): PrInput {
  const input = raw.trim();
  const asNumber = /^#?(\d+)$/.exec(input);
  if (asNumber?.[1]) return { number: Number(asNumber[1]) };

  const asSlug = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec(input);
  if (asSlug?.[1] && asSlug[2] && asSlug[3]) {
    const repo = asSlug[2].endsWith(".git") ? asSlug[2].slice(0, -".git".length) : asSlug[2];
    return { number: Number(asSlug[3]), located: { owner: asSlug[1], repo } };
  }

  try {
    const parsed = parsePrUrl(input);
    return { number: parsed.number, located: { owner: parsed.owner, repo: parsed.repo } };
  } catch (err) {
    if (err instanceof IssueError && err.code === "not-github-pr-url") {
      throw new IssueError(
        "validation",
        "Enter a pull request URL, number, or owner/repo#N.",
      );
    }
    throw err;
  }
}

function sameRepo(a: RepoName, b: RepoName): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

function originLabel(origin: RepoName): string {
  return `github.com/${origin.owner}/${origin.repo}`;
}

function wrongRepository(origin: string): IssueError {
  return new IssueError(
    "pr-wrong-repository",
    "That pull request belongs to a different repository.",
    { origin },
  );
}

function isMissingPullRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("could not resolve to a pullrequest") ||
    lower.includes("no pull requests found") ||
    (lower.includes("pull request") && lower.includes("not found"))
  );
}

async function fetchPullHead(
  workspace: string,
  number: number,
  headSha: string,
): Promise<void> {
  const ref = `refs/pull/${number}/head`;
  await runGitWrite(["fetch", "origin", `${ref}:${ref}`], workspace);
  const fetched = (await runGit(["rev-parse", ref], workspace)).trim();
  if (fetched !== headSha) {
    throw new IssueError(
      "git-failed",
      `fetched ${ref} ${fetched} does not match GitHub head ${headSha}`,
    );
  }
}

/**
 * Resolve `input` against the Project workspace's GitHub origin, then fetch
 * `refs/pull/<N>/head` so the head commit is in that workspace.
 */
export async function resolveReviewPr(
  projectId: string,
  input: string,
): Promise<ResolvedReviewPr> {
  const workspace = requireProjectWorkspace(projectId);
  const originUrl = await getOriginRemoteUrl(workspace);
  if (!originUrl) {
    throw new IssueError("validation", "Project workspace has no origin remote");
  }
  const origin = parseGitHubOrigin(originUrl);
  if (!origin) {
    throw new IssueError("validation", `origin is not a GitHub repository: ${originUrl}`);
  }
  const label = originLabel(origin);
  const parsed = parseReviewPrInput(input);
  if (parsed.located && !sameRepo(parsed.located, origin)) {
    throw wrongRepository(label);
  }

  let stdout: string;
  try {
    stdout = await runGh(
      [
        "pr",
        "view",
        String(parsed.number),
        "--repo",
        `${origin.owner}/${origin.repo}`,
        "--json",
        GH_PR_FIELDS,
      ],
      workspace,
    );
  } catch (err) {
    if (
      err instanceof IssueError &&
      err.code === "gh-failed" &&
      isMissingPullRequest(err.message)
    ) {
      throw new IssueError("pr-not-found", "Pull request not found on GitHub.");
    }
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new IssueError("gh-failed", "gh pr view returned unreadable JSON");
  }
  const view = ghPrViewSchema.safeParse(json);
  if (!view.success) {
    throw new IssueError("gh-failed", "gh pr view returned unexpected JSON");
  }
  if (view.data.number !== parsed.number) {
    throw new IssueError(
      "gh-failed",
      `gh pr view returned pull request ${view.data.number}, not ${parsed.number}`,
    );
  }

  let returned: { owner: string; repo: string; number: number };
  try {
    returned = parsePrUrl(view.data.url);
  } catch (err) {
    if (err instanceof IssueError) {
      throw new IssueError(
        "gh-failed",
        `gh pr view returned a URL that is not a pull request: ${view.data.url}`,
      );
    }
    throw err;
  }
  if (!sameRepo(returned, origin) || returned.number !== parsed.number) {
    throw wrongRepository(label);
  }

  await fetchPullHead(workspace, view.data.number, view.data.headRefOid);
  return {
    title: view.data.title,
    pr: {
      url: view.data.url,
      number: view.data.number,
      baseRef: view.data.baseRefName,
      headRef: view.data.headRefName,
      headSha: view.data.headRefOid,
      fork: view.data.isCrossRepository,
    },
  };
}

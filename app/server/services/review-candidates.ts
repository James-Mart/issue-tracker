import type { Issue } from "../schemas/issue.js";
import type { ReviewCandidate, ReviewCandidates } from "../schemas/review.js";
import { issueChangeCommitShas } from "./change.js";
import { IssueError } from "./errors.js";
import { runGit } from "./git-read.js";
import { readAll } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { requireProject } from "./require-project.js";
import { listReviewViews } from "./reviews.js";
import { subtreeIds } from "./subtree.js";

type Story = Extract<Issue, { kind: "story" }>;

function committerMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new IssueError("git-failed", `unexpected committer date "${iso}"`);
  }
  return ms;
}

function byNewestCommit(a: ReviewCandidate, b: ReviewCandidate): number {
  const byTime = committerMs(b.lastCommitAt) - committerMs(a.lastCommitAt);
  return byTime === 0 ? a.storyId.localeCompare(b.storyId) : byTime;
}

function selectCandidates(
  candidates: ReviewCandidate[],
  query: string,
  limit: number | undefined,
): ReviewCandidate[] {
  const matched =
    query === ""
      ? candidates
      : candidates.filter((story) =>
          story.title.toLowerCase().includes(query.toLowerCase()),
        );
  const sorted = [...matched].sort(byNewestCommit);
  if (query === "") {
    if (limit === undefined) {
      throw new IssueError("validation", "limit is required when query is empty");
    }
    return sorted.slice(0, limit);
  }
  return sorted;
}

/** Shas that are commits in the workspace. Missing objects are omitted. */
async function reachableCommits(workspace: string, shas: string[]): Promise<Set<string>> {
  if (shas.length === 0) return new Set();
  const text = await runGit(
    ["rev-list", "--no-walk", "--ignore-missing", ...shas],
    workspace,
  );
  return new Set(text.split("\n").filter((line) => line !== ""));
}

async function committerDates(
  workspace: string,
  shas: string[],
): Promise<Map<string, string>> {
  const text = await runGit(
    ["show", "-s", "--format=%H%x09%cI", "--no-patch", ...shas],
    workspace,
  );
  const dates = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const tab = line.indexOf("\t");
    const sha = tab > 0 ? line.slice(0, tab) : "";
    const date = tab > 0 ? line.slice(tab + 1) : "";
    if (sha === "" || date === "") {
      throw new IssueError("git-failed", `unexpected committer record "${line}"`);
    }
    committerMs(date);
    dates.set(sha, date);
  }
  for (const sha of shas) {
    if (!dates.has(sha)) {
      throw new IssueError("git-failed", `missing committer date for "${sha}"`);
    }
  }
  return dates;
}

function newestCommitterDate(shas: string[], dates: Map<string, string>): string {
  let best = dates.get(shas[0]!)!;
  let bestMs = committerMs(best);
  for (const sha of shas) {
    const iso = dates.get(sha)!;
    const ms = committerMs(iso);
    if (ms > bestMs) {
      best = iso;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Stories in the project that have at least one Task commit.
 * An empty query returns the `limit` newest by committer date.
 * A query returns every title match, case-insensitively, with no limit.
 */
export async function listReviewCandidates(
  projectId: string,
  query: string,
  limit: number | undefined,
): Promise<ReviewCandidates> {
  const id = requireProject(projectId);
  const { issues } = readAll();
  const inProject = subtreeIds(issues, id);
  const reviewByStory = new Map(
    listReviewViews(id).reviews.map((review) => [review.target.storyId, review.id]),
  );

  const withCommits: Array<{ story: Story; shas: string[] }> = [];
  for (const issue of issues) {
    if (issue.kind !== "story" || !inProject.has(issue.id)) continue;
    const shas = issueChangeCommitShas(issue, issues);
    if (shas.length === 0) continue;
    withCommits.push({ story: issue, shas });
  }
  if (withCommits.length === 0) return { stories: [] };

  const workspace = requireProjectWorkspace(id);
  const reachable = await reachableCommits(
    workspace,
    [...new Set(withCommits.flatMap((entry) => entry.shas))],
  );
  // A Task sha missing from the workspace has no committer date and cannot be reviewed.
  const committed = withCommits.flatMap((entry) => {
    const shas = entry.shas.filter((sha) => reachable.has(sha));
    return shas.length === 0 ? [] : [{ story: entry.story, shas }];
  });
  if (committed.length === 0) return { stories: [] };

  const dates = await committerDates(
    workspace,
    [...new Set(committed.flatMap((entry) => entry.shas))],
  );
  const candidates = committed.map(({ story, shas }) => {
    const reviewId = reviewByStory.get(story.id);
    return {
      storyId: story.id,
      title: story.title,
      merged: story.merged,
      ...(reviewId ? { reviewId } : {}),
      lastCommitAt: newestCommitterDate(shas, dates),
    };
  });
  return { stories: selectCandidates(candidates, query, limit) };
}

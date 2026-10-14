import type { Issue } from "../schemas/issue.js";
import type { ReviewIssue } from "../schemas/review.js";
import type { ReviewPrSource } from "../schemas/review-state.js";
import {
  readPullRequests,
  type PrFacts,
  type PrUnavailable,
} from "./delivery.js";
import { IssueError } from "./errors.js";
import { readAll } from "./issues.js";
import type { PrSyncPassResult, PrSyncStepResult } from "./pr-sync-driver.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { fetchReviewPullRefs } from "./review-pr.js";
import { applyReviewWorktreeTransition } from "./review-worktree.js";
import { syncReviewWorktree } from "./review-worktree-sync.js";
import { readReviewView, updateStoredReview } from "./reviews.js";
import { refusesStoreWrites } from "./store-read-only.js";
import { subtreeIds } from "./subtree.js";

export type PullRequestObservation = {
  headSha: string;
  state: PrFacts["state"];
};

type ReviewWithPr = ReviewIssue & { pr: ReviewPrSource };

function failureMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Last stored state, treating absence as open. `open` is not written until a
 * later observation leaves a terminal state, so a loaded review stays quiet
 * while its pull request stays open.
 */
function storedStateChanged(
  stored: ReviewPrSource["state"],
  next: PullRequestObservation["state"],
): boolean {
  if (stored === undefined) return next !== "open";
  return stored !== next;
}

/**
 * Head, followed GitHub state, and PR-only archive for one observation.
 * Returns `review` when nothing changed. A review that has a Story keeps its
 * archive on that Story. Reopening stays open until GitHub's state changes
 * again.
 */
export function applyReviewPrObservation(
  review: ReviewIssue,
  observation: PullRequestObservation,
  now: string,
): ReviewIssue {
  if (!review.pr) return review;
  const headMoved = review.pr.headSha !== observation.headSha;
  const stateChanged = storedStateChanged(review.pr.state, observation.state);
  const terminal = observation.state === "merged" || observation.state === "closed";
  const archive =
    review.story === undefined && !review.archived && terminal && stateChanged;
  if (!headMoved && !stateChanged) return review;
  return {
    ...review,
    pr: {
      ...review.pr,
      ...(headMoved ? { headSha: observation.headSha } : {}),
      ...(stateChanged ? { state: observation.state } : {}),
    },
    ...(archive ? { archived: true } : {}),
    updatedAt: now,
  };
}

function isReviewWithPr(issue: Issue): issue is ReviewWithPr {
  return issue.kind === "review" && issue.pr !== undefined;
}

export function reviewsWithPullRequests(projectId: string): ReviewWithPr[] {
  const { issues } = readAll();
  const inProject = subtreeIds(issues, projectId);
  return issues
    .filter((issue): issue is ReviewWithPr => isReviewWithPr(issue) && inProject.has(issue.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function observationFrom(
  remote: PrFacts | PrUnavailable | undefined,
): PullRequestObservation | "not-found" {
  if (!remote || "reason" in remote) return "not-found";
  if (remote.headRefOid.length === 0) {
    throw new IssueError("gh-failed", "gh returned a pull request with no head");
  }
  return { headSha: remote.headRefOid, state: remote.state };
}

async function followStoredReview(
  projectId: string,
  review: { id: string; pr: ReviewPrSource; archived: boolean },
  observation: PullRequestObservation,
  workspace: string,
): Promise<void> {
  await fetchReviewPullRefs(workspace, {
    number: review.pr.number,
    baseRef: review.pr.baseRef,
    ...(review.pr.headSha !== observation.headSha
      ? { headSha: observation.headSha }
      : {}),
  });
  const now = new Date().toISOString();
  const after = updateStoredReview(projectId, review.id, (current) =>
    applyReviewPrObservation(current, observation, now),
  );
  if (!review.archived && after.archived) {
    await applyReviewWorktreeTransition({ remove: [review.id], ensure: [] });
    return;
  }
  if (review.pr.headSha !== observation.headSha && !after.archived) {
    await syncReviewWorktree(review.id, "auto");
  }
}

/**
 * Follow this review's pull request before the workbench reads it.
 * No pull request leaves the review unchanged. A read-only server cannot
 * record a new head, so it serves the stored review.
 */
export async function refreshReviewPullRequest(
  projectId: string,
  reviewId: string,
): Promise<void> {
  const view = readReviewView(projectId, reviewId);
  if (!view.pr || refusesStoreWrites()) return;
  const workspace = requireProjectWorkspace(projectId);
  const found = await readPullRequests([view.pr.url], workspace);
  const observation = observationFrom(found.get(view.pr.url));
  if (observation === "not-found") {
    throw new IssueError("pr-not-found", "Pull request not found on GitHub.");
  }
  await followStoredReview(
    projectId,
    { id: view.id, pr: view.pr, archived: view.archived },
    observation,
    workspace,
  );
}

/**
 * Sync-pass step. Follows each review pull request's head and archives a
 * PR-only review when that pull request becomes merged or closed.
 * A pull request GitHub no longer returns is not merged or closed; the
 * review stays, and the pass continues so later steps still run.
 */
export async function trackReviewPullRequests(
  projectId: string,
  previous: PrSyncStepResult,
): Promise<PrSyncPassResult> {
  const reviews = reviewsWithPullRequests(projectId);
  if (reviews.length === 0) return previous;

  let workspace: string;
  try {
    workspace = requireProjectWorkspace(projectId);
  } catch (err) {
    return { ...previous, error: failureMessage(err) };
  }

  let found: Map<string, PrFacts | PrUnavailable>;
  try {
    found = await readPullRequests(
      [...new Set(reviews.map((review) => review.pr.url))],
      workspace,
    );
  } catch (err) {
    return { ...previous, error: failureMessage(err) };
  }

  const failures: string[] = [];
  for (const review of reviews) {
    let observation: PullRequestObservation | "not-found";
    try {
      observation = observationFrom(found.get(review.pr.url));
    } catch (err) {
      failures.push(`${review.id}: ${failureMessage(err)}`);
      continue;
    }
    if (observation === "not-found") {
      console.error(
        `pr sync: review ${review.id} pull request ${review.pr.url} was not found; leaving its head`,
      );
      continue;
    }
    try {
      await followStoredReview(projectId, review, observation, workspace);
    } catch (err) {
      failures.push(`${review.id}: ${failureMessage(err)}`);
    }
  }
  return failures.length > 0 ? { ...previous, error: failures.join("; ") } : previous;
}

import type { Issue } from "../schemas/issue.js";
import type { ReviewIssue } from "../schemas/review.js";
import type { ReviewPrSource } from "../schemas/review-state.js";
import { readPullRequests } from "./delivery.js";
import { IssueError } from "./errors.js";
import { readAll } from "./issues.js";
import type { PrSyncPassResult, PrSyncStepResult } from "./pr-sync-driver.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { resolveReviewPr } from "./review-pr.js";
import { syncReviewWorktree } from "./review-worktree-sync.js";
import {
  pullRequestKey,
  storedReviewForStory,
  storyForPullRequest,
  updateStoredReview,
} from "./reviews.js";

type Story = Extract<Issue, { kind: "story" }>;

function failureMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function samePullRequest(a: string, b: string): boolean {
  const keyA = pullRequestKey(a);
  const keyB = pullRequestKey(b);
  return keyA !== undefined && keyA === keyB;
}

/**
 * GitHub allows one open pull request per head and base, so a replaced one is
 * closed, merged, or gone. The stored state may predate the close, since
 * tracking runs after this step, so an open stored state is checked live.
 */
async function replaceable(projectId: string, pr: ReviewPrSource): Promise<boolean> {
  if (pr.state === "closed" || pr.state === "merged") return true;
  const workspace = requireProjectWorkspace(projectId);
  const live = (await readPullRequests([pr.url], workspace)).get(pr.url);
  return !live || "reason" in live || live.state !== "open";
}

async function followStoryPullRequest(
  projectId: string,
  reviewId: string,
  storyId: string,
  prUrl: string,
): Promise<void> {
  const { pr } = await resolveReviewPr(projectId, prUrl);
  updateStoredReview(projectId, reviewId, (current) => {
    if (current.story !== storyId) return current;
    if (current.pr && samePullRequest(current.pr.url, pr.url)) return current;
    return { ...current, pr, updatedAt: new Date().toISOString() };
  });
}

async function adoptStory(
  projectId: string,
  review: ReviewIssue & { pr: ReviewPrSource },
  story: Story,
  issues: Issue[],
): Promise<void> {
  updateStoredReview(projectId, review.id, (current) => {
    if (current.story !== undefined || !current.pr) return current;
    if (!samePullRequest(current.pr.url, review.pr.url)) return current;
    const other = storedReviewForStory(story.id, issues);
    if (other && other.id !== current.id) {
      throw new IssueError(
        "validation",
        `story ${story.id} already has review ${other.id}`,
      );
    }
    return { ...current, story: story.id, updatedAt: new Date().toISOString() };
  });
  await syncReviewWorktree(review.id, "auto");
}

/**
 * The Story's `prUrl` and its review's `pr` name one pull request. Missing
 * means not linked yet; a Story whose pull request was replaced is followed.
 * An open review pull request that disagrees is a failure, and the review is
 * left alone.
 */
async function linkStoryReview(
  projectId: string,
  review: ReviewIssue,
  story: Story | undefined,
): Promise<void> {
  const prUrl = story?.prUrl;
  if (!story || !prUrl) return;
  if (review.pr && samePullRequest(review.pr.url, prUrl)) return;
  if (review.pr && !(await replaceable(projectId, review.pr))) {
    throw new IssueError(
      "validation",
      `review pull request ${review.pr.url} is open but story ${story.id} has ${prUrl}`,
    );
  }
  await followStoryPullRequest(projectId, review.id, story.id, prUrl);
}

/**
 * A pull-request-only review becomes its Story's review once a Story in this
 * Project owns that pull request. A Story that already has a review is a
 * failure. A merged or archived Story is left alone, since its reviews were
 * archived when it closed.
 */
async function linkPullRequestReview(
  projectId: string,
  review: ReviewIssue & { pr: ReviewPrSource },
  issues: Issue[],
): Promise<void> {
  const story = storyForPullRequest(projectId, review.pr, issues);
  if (!story || story.merged || story.archived) return;
  const other = storedReviewForStory(story.id, issues);
  if (other) {
    throw new IssueError(
      "validation",
      `pull request ${review.pr.url} belongs to story ${story.id}, which already has review ${other.id}`,
    );
  }
  await adoptStory(projectId, review, story, issues);
}

/**
 * Sync-pass step after PR reconcile, before review pull request tracking.
 * Keeps each open review's pull request in agreement with its Story's
 * `prUrl`, so later steps see Story reviews that gained a pull request.
 * A failing review does not stop the others; every failure is named in
 * `error`.
 */
export async function linkReviewPullRequests(
  projectId: string,
  previous: PrSyncStepResult,
): Promise<PrSyncPassResult> {
  const { issues } = readAll();
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const reviews = issues
    .filter(
      (issue): issue is ReviewIssue =>
        issue.kind === "review" && issue.partOf === projectId && !issue.archived,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const failures: string[] = [];
  for (const review of reviews) {
    try {
      if (review.story) {
        const story = byId.get(review.story);
        await linkStoryReview(
          projectId,
          review,
          story?.kind === "story" ? story : undefined,
        );
      } else if (review.pr) {
        await linkPullRequestReview(
          projectId,
          review as ReviewIssue & { pr: ReviewPrSource },
          issues,
        );
      }
    } catch (err) {
      failures.push(`${review.id}: ${failureMessage(err)}`);
    }
  }
  return failures.length > 0 ? { ...previous, error: failures.join("; ") } : previous;
}

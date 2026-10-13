import { existsSync } from "fs";
import type { Issue } from "../schemas.js";
import type { ReviewIssue } from "../schemas/review.js";
import { storyTipSha } from "./change.js";
import { IssueError } from "./errors.js";
import {
  assertGuestAllowsOutwardEffect,
  GUEST_REFUSED_REVIEW_WORKTREE_CREATE,
  guestRefusesOutwardEffect,
} from "./guest-outward-effects.js";
import { ensureMigrations, readAll, readReviewOrThrow } from "./issues.js";
import { refusesStoreWrites } from "./store-read-only.js";
import {
  addWorktreeCheckout,
  removeWorktreeCheckout,
} from "./worktree-checkout.js";
import type { AttemptedWorktreeRemoval } from "./worktree.js";

/**
 * Reviewed tip. A Story source wins when both sources are set: the Story's
 * latest task commit, or the pull request head when the review has no Story.
 */
export function reviewedTipSha(
  review: { story?: string; pr?: { headSha: string } },
  issues: readonly Issue[],
): string {
  if (review.story) return storyTipSha(review.story, issues);
  return review.pr?.headSha ?? "";
}

export type ReviewWorktreeTransition = {
  remove: string[];
  ensure: string[];
};

/** Reviews whose archive or reopen in this write should drop or recreate a checkout. */
export function reviewWorktreeTransitions(
  existing: Issue,
  next: Issue,
  archivedReviews: readonly { id: string }[],
): ReviewWorktreeTransition {
  const remove: string[] = [];
  const ensure: string[] = [];
  if (existing.kind === "review" && next.kind === "review") {
    if (!existing.archived && next.archived) remove.push(existing.id);
    if (existing.archived && !next.archived) ensure.push(existing.id);
  }
  for (const review of archivedReviews) {
    if (!remove.includes(review.id)) remove.push(review.id);
  }
  return { remove, ensure };
}

function requireOpenReview(reviewId: string): ReviewIssue {
  const review = readReviewOrThrow(reviewId);
  if (review.archived) {
    throw new IssueError("validation", `review "${reviewId}" is archived`);
  }
  return review;
}

function requireTip(review: ReviewIssue, issues: readonly Issue[]): string {
  const tip = reviewedTipSha(review, issues);
  if (!tip) {
    throw new IssueError("validation", `review "${review.id}" has no reviewed tip`);
  }
  return tip;
}

/** Open review, its live checkout, and the reviewed tip. */
export function requireOpenReviewCheckout(reviewId: string): {
  worktree: string;
  tip: string;
} {
  const review = requireOpenReview(reviewId);
  return {
    worktree: liveReviewWorktreePath(review),
    tip: requireTip(review, readAll().issues),
  };
}

/** Absolute checkout recorded on a review. A missing directory fails the caller. */
export function liveReviewWorktreePath(review: ReviewIssue): string {
  if (!review.worktreePath || !existsSync(review.worktreePath)) {
    throw new IssueError(
      "validation",
      `review "${review.id}" has no live worktree`,
    );
  }
  return review.worktreePath;
}

/** Absolute checkout for a question researcher. Missing checkouts fail the launch. */
export function requireLiveReviewWorktree(reviewId: string): string {
  return liveReviewWorktreePath(readReviewOrThrow(reviewId));
}

/**
 * Detached checkout of the reviewed tip, then the Project setup command.
 * A live checkout is left as it is. A recorded path whose directory is gone
 * is dropped before the new checkout is added.
 */
export async function ensureReviewWorktree(reviewId: string): Promise<string> {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_REVIEW_WORKTREE_CREATE);
  const review = requireOpenReview(reviewId);
  const { issues } = readAll();
  if (review.worktreePath && existsSync(review.worktreePath)) {
    return review.worktreePath;
  }
  if (review.worktreePath) await removeWorktreeCheckout(reviewId);
  const tip = requireTip(review, issues);
  return addWorktreeCheckout(reviewId, { mode: "detach", commit: tip });
}

/**
 * Drop a review checkout. Guest keeps a live directory so the store write
 * that archived or deleted the review still lands.
 */
export async function attemptReviewWorktreeRemoval(
  reviewId: string,
): Promise<AttemptedWorktreeRemoval> {
  const issue = readAll().issues.find((item) => item.id === reviewId);
  if (!issue || issue.kind !== "review" || !issue.worktreePath) {
    return { outcome: "absent" };
  }
  const path = issue.worktreePath;
  if (guestRefusesOutwardEffect()) {
    return existsSync(path) ? { outcome: "retained", path } : { outcome: "absent" };
  }
  const { stopReviewRuntime } = await import("./review-runtime.js");
  await stopReviewRuntime(reviewId, { syncWorktree: false });
  await removeWorktreeCheckout(reviewId);
  return { outcome: "removed", path };
}

export async function applyReviewWorktreeTransition(
  transition: ReviewWorktreeTransition,
): Promise<void> {
  for (const id of transition.remove) {
    await attemptReviewWorktreeRemoval(id);
  }
  for (const id of transition.ensure) {
    await ensureReviewWorktree(id);
  }
}

/**
 * Each open review gets a live checkout. An archived review loses any checkout
 * still recorded on it. A failure on one review is logged and the pass continues.
 */
export async function migrateOpenReviewWorktrees(): Promise<void> {
  if (guestRefusesOutwardEffect() || refusesStoreWrites()) return;
  ensureMigrations();
  const reviews = readAll().issues.filter(
    (issue): issue is ReviewIssue => issue.kind === "review",
  );
  for (const review of reviews) {
    if (review.archived) {
      if (!review.worktreePath) continue;
      try {
        await attemptReviewWorktreeRemoval(review.id);
      } catch (err) {
        console.error(`review worktree removal failed for ${review.id}:`, err);
      }
      continue;
    }
    if (review.worktreePath && existsSync(review.worktreePath)) continue;
    try {
      await ensureReviewWorktree(review.id);
    } catch (err) {
      console.error(`review worktree migration failed for ${review.id}:`, err);
    }
  }
}

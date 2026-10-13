import { existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { conversationsDir } from "../config.js";
import { isSlugSafe } from "../slug.js";
import type { Issue } from "../schemas.js";
import type { ReviewIssue, ReviewWorktreeSyncHold } from "../schemas/review.js";
import { isStackLive, readAgentStackState } from "./agent-stack.js";
import { reviewRuntimeBusy } from "./review-runtime-occupancy.js";
import {
  assertGuestAllowsOutwardEffect,
  GUEST_REFUSED_REVIEW_WORKTREE_SYNC,
  guestRefusesOutwardEffect,
} from "./guest-outward-effects.js";
import { revListCount, runGit } from "./git-read.js";
import { runGitWrite } from "./git-write.js";
import { readAll, readReviewOrThrow } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { requireOpenReviewCheckout, reviewedTipSha } from "./review-worktree.js";
import {
  researcherConversationIds,
  researcherLaunchBusy,
} from "./researcher-runs.js";
import { isRunLive } from "./run-live.js";
import { assertStoreWritable, refusesStoreWrites } from "./store-read-only.js";

export type ReviewWorktreeSyncMode = "auto" | "now";

const syncTails = new Map<string, Promise<void>>();

function enqueue<T>(reviewId: string, job: () => Promise<T>): Promise<T> {
  const prev = syncTails.get(reviewId) ?? Promise.resolve();
  const run = prev.then(job, job);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  syncTails.set(reviewId, tail);
  void tail.finally(() => {
    if (syncTails.get(reviewId) === tail) syncTails.delete(reviewId);
  });
  return run;
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

/** A conversation agent stack booted from this checkout still has a live process. */
function agentStackBusy(worktree: string): boolean {
  if (!existsSync(conversationsDir)) return false;
  for (const entry of readdirSync(conversationsDir)) {
    if (!isSlugSafe(entry)) continue;
    const dir = join(conversationsDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const state = readAgentStackState(entry);
    if (!state || !samePath(state.worktree, worktree) || !isStackLive(state)) continue;
    return true;
  }
  return false;
}

/** A runtime booted from this checkout still has a live process. */
function runtimeBusy(worktree: string): boolean {
  return agentStackBusy(worktree) || reviewRuntimeBusy(worktree);
}

/** A researcher launch or run on this review is still live. */
function researcherBusy(reviewId: string): boolean {
  if (researcherLaunchBusy(reviewId)) return true;
  return researcherConversationIds(reviewId).some((conversationId) =>
    isRunLive(conversationId),
  );
}

function reviewBusy(review: ReviewIssue): boolean {
  if (review.worktreePath && runtimeBusy(review.worktreePath)) return true;
  return researcherBusy(review.id);
}

/**
 * Branch the new commits are on. A Story source names that Story's branch;
 * a pull-request-only review names the pull request head.
 */
function syncRef(review: ReviewIssue, issues: readonly Issue[]): string {
  if (review.story) {
    const story = issues.find((issue) => issue.id === review.story);
    if (story?.kind === "story" && story.branchName) return story.branchName;
    if (review.pr) return review.pr.headRef;
    return review.story;
  }
  return review.pr?.headRef ?? "";
}

/**
 * Commits on the tip the checkout does not have. A tip that moved without
 * adding commits (a rewrite or rewind) still counts as one.
 */
function newCommitCount(ahead: number): number {
  return ahead > 0 ? ahead : 1;
}

async function holdFor(
  review: ReviewIssue,
  issues: readonly Issue[],
  head: string,
  tip: string,
): Promise<ReviewWorktreeSyncHold> {
  const ahead = await revListCount(requireProjectWorkspace(review.partOf), [
    `${head}..${tip}`,
  ]);
  return { newCommits: newCommitCount(ahead), ref: syncRef(review, issues) };
}

async function checkoutTip(worktree: string, head: string, tip: string): Promise<void> {
  if (head === tip) return;
  await runGitWrite(["checkout", "-f", "--detach", tip], worktree);
}

async function readCheckout(review: ReviewIssue): Promise<{
  head: string;
  tip: string;
  issues: readonly Issue[];
} | undefined> {
  if (review.archived || !review.worktreePath || !existsSync(review.worktreePath)) {
    return undefined;
  }
  const issues = readAll().issues;
  const tip = reviewedTipSha(review, issues);
  if (!tip) return undefined;
  const head = (await runGit(["rev-parse", "HEAD"], review.worktreePath)).trim();
  return { head, tip, issues };
}

type CheckoutSync =
  | { behind: false }
  | { behind: true; held: true; hold: ReviewWorktreeSyncHold }
  | { behind: true; held: false; worktree: string; head: string; tip: string };

/** One pass: current, held because busy, or behind and free to check out. */
async function classifyCheckout(review: ReviewIssue): Promise<CheckoutSync> {
  const checkout = await readCheckout(review);
  if (!checkout || checkout.head === checkout.tip) return { behind: false };
  if (reviewBusy(review)) {
    return {
      behind: true,
      held: true,
      hold: await holdFor(review, checkout.issues, checkout.head, checkout.tip),
    };
  }
  return {
    behind: true,
    held: false,
    worktree: review.worktreePath!,
    head: checkout.head,
    tip: checkout.tip,
  };
}

/** Hold descriptor when the checkout is behind and the worktree is busy. */
export function reviewWorktreeHold(
  reviewId: string,
): Promise<ReviewWorktreeSyncHold | undefined> {
  return enqueue(reviewId, async () => {
    const classified = await classifyCheckout(readReviewOrThrow(reviewId));
    return classified.behind && classified.held ? classified.hold : undefined;
  });
}

/**
 * Move the review checkout onto the reviewed tip.
 * `auto` waits while a runtime booted from the worktree or a researcher run
 * on the review is live, and returns that hold. `now` checks out immediately.
 */
export function syncReviewWorktree(
  reviewId: string,
  mode: ReviewWorktreeSyncMode,
): Promise<ReviewWorktreeSyncHold | undefined> {
  return enqueue(reviewId, () => syncReviewWorktreeBody(reviewId, mode));
}

async function syncReviewWorktreeNow(
  reviewId: string,
): Promise<ReviewWorktreeSyncHold | undefined> {
  assertStoreWritable();
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_REVIEW_WORKTREE_SYNC);
  const { worktree, tip } = requireOpenReviewCheckout(reviewId);
  const head = (await runGit(["rev-parse", "HEAD"], worktree)).trim();
  await checkoutTip(worktree, head, tip);
  return undefined;
}

async function syncReviewWorktreeAuto(
  reviewId: string,
): Promise<ReviewWorktreeSyncHold | undefined> {
  const classified = await classifyCheckout(readReviewOrThrow(reviewId));
  if (!classified.behind) return undefined;
  if (classified.held) return classified.hold;
  if (refusesStoreWrites() || guestRefusesOutwardEffect()) return undefined;
  await checkoutTip(classified.worktree, classified.head, classified.tip);
  return undefined;
}

async function syncReviewWorktreeBody(
  reviewId: string,
  mode: ReviewWorktreeSyncMode,
): Promise<ReviewWorktreeSyncHold | undefined> {
  return mode === "now"
    ? syncReviewWorktreeNow(reviewId)
    : syncReviewWorktreeAuto(reviewId);
}

/** Sync the open review of this Story when its task commits moved the tip. */
export async function syncReviewsAtStoryTip(storyId: string): Promise<void> {
  const { issues } = readAll();
  for (const issue of issues) {
    if (issue.kind !== "review" || issue.archived || issue.story !== storyId) continue;
    await syncReviewWorktree(issue.id, "auto");
  }
}

/** Sync every open review whose checkout is this worktree. */
export async function syncReviewsAtWorktree(worktree: string): Promise<void> {
  const { issues } = readAll();
  for (const issue of issues) {
    if (issue.kind !== "review" || issue.archived || !issue.worktreePath) continue;
    if (!samePath(issue.worktreePath, worktree)) continue;
    await syncReviewWorktree(issue.id, "auto");
  }
}

import { existsSync } from "fs";
import type { Issue } from "../schemas.js";
import { deriveStoryWorktree } from "./derive-worktree.js";
import { IssueError } from "./errors.js";
import { branchExists, currentBranch } from "./git-read.js";
import {
  assertGuestAllowsOutwardEffect,
  GUEST_REFUSED_WORKTREE_ATTACH,
  GUEST_REFUSED_WORKTREE_CREATE,
  GUEST_REFUSED_WORKTREE_REMOVE,
  GUEST_REFUSED_WORKTREE_SETUP,
  guestRefusesOutwardEffect,
} from "./guest-outward-effects.js";
import { resolveMergeBaseRef } from "./resolve-merge-base-ref.js";
import { hasActiveImplementingRun } from "./implementing-status.js";
import { list, readAll, update } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import {
  addWorktreeCheckout,
  assertNoLiveWorktree,
  projectIdOf,
  removeWorktreeCheckout,
  runWorktreeSetup,
} from "./worktree-checkout.js";

export { setupLogPathFor, worktreePathFor } from "../worktree-constants.js";

type Story = Extract<Issue, { kind: "story" }>;

function requireStory(storyId: string): Story {
  const { issues } = list();
  const story = issues.find((issue) => issue.id === storyId);
  if (!story || story.kind !== "story") {
    throw new IssueError("not_found", `story "${storyId}" does not exist`);
  }
  return story;
}

export const CREATE_HAS_BRANCH_ERROR = (storyId: string) =>
  `worktree create refuses Story "${storyId}" that already has branchName`;

export const CREATE_NO_MERGE_BASE_ERROR = (storyId: string, parentId: string) =>
  `worktree create refuses Story "${storyId}" stacked on Story "${parentId}" which has no branch yet`;

export const ATTACH_NO_BRANCH_ERROR = (storyId: string) =>
  `worktree attach requires branchName on Story "${storyId}"`;

export const ATTACH_BRANCH_MISSING_ERROR = (storyId: string, branchName: string) =>
  `worktree attach refuses Story "${storyId}": branch "${branchName}" does not exist in the Project repository`;

export const ATTACH_BRANCH_CHECKED_OUT_ERROR = (storyId: string, branchName: string) =>
  `worktree attach refuses Story "${storyId}": branch "${branchName}" is checked out in the Project workspace`;

export const REMOVE_ACTIVE_IMPLEMENTING_ERROR = (storyId: string) =>
  `worktree remove refuses Story "${storyId}" while an implementing session is active`;

export const REMOVE_UNSAFE_ERROR = (
  storyId: string,
  uncommittedCount: number,
  atRiskCommitCount: number,
) =>
  `worktree remove refuses Story "${storyId}": ${uncommittedCount} uncommitted change(s), ${atRiskCommitCount} at-risk commit(s)`;

export const REMOVE_LOCKED_ERROR = (storyId: string) =>
  `worktree remove refuses Story "${storyId}": worktree is locked`;

export async function createStoryWorktree(storyId: string): Promise<string> {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_WORKTREE_CREATE);
  const { issues, derived } = list();
  const story = requireStory(storyId);
  const projectId = projectIdOf(story, issues);
  const workspace = requireProjectWorkspace(projectId);

  if (story.branchName) {
    throw new IssueError("validation", CREATE_HAS_BRANCH_ERROR(storyId));
  }

  assertNoLiveWorktree(story);

  const mergeBase = derived[storyId]?.mergeBase;
  if (!mergeBase) {
    const parentId = story.stackedOn;
    if (!parentId) {
      throw new IssueError(
        "validation",
        `worktree create requires mergeBase on Story "${storyId}"`,
      );
    }
    await update(storyId, { worktreeBlockedReason: "parent-branch" });
    throw new IssueError(
      "validation",
      CREATE_NO_MERGE_BASE_ERROR(storyId, parentId),
    );
  }

  const startRef = await resolveMergeBaseRef(workspace, mergeBase);
  return addWorktreeCheckout(
    storyId,
    { mode: "new-branch", branch: storyId, startRef },
    { worktreeBlockedReason: null },
  );
}

export async function attachStoryWorktree(storyId: string): Promise<string> {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_WORKTREE_ATTACH);
  const { issues } = list();
  const story = requireStory(storyId);
  const projectId = projectIdOf(story, issues);
  const workspace = requireProjectWorkspace(projectId);

  if (!story.branchName) {
    throw new IssueError("validation", ATTACH_NO_BRANCH_ERROR(storyId));
  }

  assertNoLiveWorktree(story);

  if (!(await branchExists(workspace, story.branchName))) {
    throw new IssueError(
      "validation",
      ATTACH_BRANCH_MISSING_ERROR(storyId, story.branchName),
    );
  }

  const checkedOut = await currentBranch(workspace);
  if (checkedOut === story.branchName) {
    throw new IssueError(
      "validation",
      ATTACH_BRANCH_CHECKED_OUT_ERROR(storyId, story.branchName),
    );
  }

  return addWorktreeCheckout(
    storyId,
    { mode: "existing-branch", branch: story.branchName },
    { worktreeBlockedReason: null },
  );
}

export type AttemptedWorktreeRemoval =
  | { outcome: "removed"; path: string }
  | { outcome: "absent" }
  | { outcome: "retained"; path: string };

export async function attemptStoryWorktreeRemoval(
  storyId: string,
): Promise<AttemptedWorktreeRemoval> {
  let path: string | undefined;
  try {
    const story = readAll().issues.find((issue) => issue.id === storyId);
    if (!story || story.kind !== "story") return { outcome: "absent" };
    path = story.worktreePath;
    if (!path) return { outcome: "absent" };
    // The copied store records the human's worktree paths. Guest keeps them
    // so the store write that triggered removal still lands.
    if (guestRefusesOutwardEffect()) {
      return existsSync(path)
        ? { outcome: "retained", path }
        : { outcome: "absent" };
    }
    await removeStoryWorktree(storyId, { allowActiveRun: true });
    return { outcome: "removed", path };
  } catch (err) {
    // Automatic callers never pass --discard. Absorb a removal refusal
    // (unsafe checkout, locked worktree, or active implementing).
    if (!(err instanceof IssueError) || err.code !== "conflict") throw err;
    if (path && existsSync(path)) return { outcome: "retained", path };
    return { outcome: "absent" };
  }
}

export function storyIdsForLifecycleRemoval(
  existing: Issue,
  next: Issue,
  archivedCascadePatches: readonly { id: string; archived: boolean }[],
  issues: Issue[],
): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (!ids.includes(id)) ids.push(id);
  };
  if (existing.kind === "story" && next.kind === "story") {
    if (!existing.merged && next.merged) add(existing.id);
    if (!existing.archived && next.archived) add(existing.id);
  }
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  for (const patch of archivedCascadePatches) {
    if (!patch.archived) continue;
    if (byId.get(patch.id)?.kind === "story") add(patch.id);
  }
  return ids;
}

export async function removeStoryWorktree(
  storyId: string,
  options: { discard?: boolean; allowActiveRun?: boolean } = {},
): Promise<string> {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_WORKTREE_REMOVE);
  const { issues } = list();
  const story = requireStory(storyId);
  const projectId = projectIdOf(story, issues);
  requireProjectWorkspace(projectId);
  const path = story.worktreePath;

  if (path && existsSync(path)) {
    if (!options.allowActiveRun && hasActiveImplementingRun(storyId)) {
      throw new IssueError("conflict", REMOVE_ACTIVE_IMPLEMENTING_ERROR(storyId));
    }

    const worktree = await deriveStoryWorktree(story, issues);
    if (worktree.locked) {
      throw new IssueError("conflict", REMOVE_LOCKED_ERROR(storyId));
    }

    const uncommittedCount = worktree.uncommittedCount;
    const atRiskCommitCount = worktree.atRiskCommitCount;

    if (!options.discard && (uncommittedCount > 0 || atRiskCommitCount > 0)) {
      throw new IssueError(
        "conflict",
        REMOVE_UNSAFE_ERROR(storyId, uncommittedCount, atRiskCommitCount),
        { uncommittedCount, atRiskCommitCount },
      );
    }
  }

  return removeWorktreeCheckout(storyId);
}

export async function setupStoryWorktree(storyId: string): Promise<string> {
  assertGuestAllowsOutwardEffect(GUEST_REFUSED_WORKTREE_SETUP);
  requireStory(storyId);
  return runWorktreeSetup(storyId);
}

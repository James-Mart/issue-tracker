import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue, IssuePatch } from "../schemas.js";
import { isWorkRootFinished } from "../../src/features/issues/lib/derived.js";
import { derive } from "./derive.js";
import { forEachOnDiskIssue } from "./scan-disk.js";
import { projectContaining } from "./subtree.js";
import { IssueError } from "./errors.js";
import { slotHoldingRootIds, type WorkRoot } from "./work-slots.js";

export function refuseWorkQueueConflict(reason: string, message: string): never {
  throw new IssueError("conflict", message, { reason });
}

const POSITION_BACKFILL_FLAG = ".work-queue-position-backfilled";

function positionFlagPath(): string {
  return join(issuesDir, POSITION_BACKFILL_FLAG);
}

/** `workQueuedAt` order, then id. Shared by backfill and the launcher tie-break. */
export function compareWorkQueuedAtThenId(a: WorkRoot, b: WorkRoot): number {
  return (
    a.workQueuedAt!.localeCompare(b.workQueuedAt!) || a.id.localeCompare(b.id)
  );
}

/** Clear queue membership and any resume note waiting with it. */
export function queueDeparturePatch(): IssuePatch {
  return {
    workQueuedAt: null,
    workQueuePosition: null,
    workParkedAt: null,
    workResumeNote: null,
  };
}

function blockersOf(root: WorkRoot): string[] {
  return root.kind === "epic" ? root.blockedBy : [];
}

export function nextQueuePosition(
  projectId: string,
  issues: Issue[],
  byId: Map<string, Issue>,
): number {
  let max = 0;
  for (const issue of issues) {
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    if (projectContaining(issue, byId) !== projectId) continue;
    if (
      issue.workQueuePosition !== undefined &&
      issue.workQueuePosition > max
    ) {
      max = issue.workQueuePosition;
    }
  }
  return max + 1;
}

/**
 * A blocker allows a dependent onto the queue when that blocker is already
 * in the queue (waiting or holding a slot) or its loop is finished (done,
 * merged, or ready to land).
 */
function blockerAllowsEnqueue(
  blockerId: string,
  byId: Map<string, Issue>,
  issues: Issue[],
  derived: ReturnType<typeof derive>,
  slotHolders: Set<string>,
): boolean {
  const blocker = byId.get(blockerId);
  if (blocker?.kind !== "epic" && blocker?.kind !== "story") return false;
  if (blocker.workQueuedAt || blocker.workParkedAt || slotHolders.has(blocker.id)) {
    return true;
  }
  return isWorkRootFinished(blocker, issues, derived.byId);
}

/**
 * First `blockedBy` root that is neither in the queue (waiting or holding a
 * slot) nor finished (done, merged, or ready to land). Manual enqueue refuses
 * that root; release leaves it unqueued.
 */
export function firstBlockingEnqueueBlocker(
  root: WorkRoot,
  issues: Issue[],
  derived: ReturnType<typeof derive>,
  byId: Map<string, Issue>,
  slotHolders: Set<string>,
): { id: string; title: string } | undefined {
  const blockerIds = blockersOf(root);
  for (const blockerId of blockerIds) {
    if (blockerAllowsEnqueue(blockerId, byId, issues, derived, slotHolders)) {
      continue;
    }
    const blocker = byId.get(blockerId);
    const title =
      blocker?.kind === "epic" || blocker?.kind === "story"
        ? blocker.title
        : blockerId;
    return { id: blockerId, title };
  }
  return undefined;
}

export const ENQUEUE_ALREADY_QUEUED = "already-queued";
export const ENQUEUE_HOLDS_SLOT = "holds-slot";

type QueueRefusal = { reason: string; message: string };

/**
 * Why `root` cannot join its Project's queue now: archived, finished,
 * already queued or parked, holding a slot, or behind a blocker that is
 * neither queued nor finished. Undefined when it can join.
 */
export function queueRefusal(
  root: WorkRoot,
  issues: Issue[],
  byId: Map<string, Issue>,
): QueueRefusal | undefined {
  if (root.archived) {
    return { reason: "archived", message: `work root "${root.title}" is archived` };
  }
  const derived = derive(issues);
  if (isWorkRootFinished(root, issues, derived.byId)) {
    return { reason: "finished", message: `work root "${root.title}" is finished` };
  }
  if (root.workQueuedAt || root.workParkedAt) {
    return {
      reason: ENQUEUE_ALREADY_QUEUED,
      message: `work root "${root.title}" is already queued`,
    };
  }
  const projectId = projectContaining(root, byId);
  if (!projectId) {
    throw new IssueError("validation", `work root "${root.id}" has no project`);
  }
  const slotHolders = slotHoldingRootIds(projectId, {
    issues,
    derived: derived.byId,
    byId,
  });
  if (slotHolders.has(root.id)) {
    return {
      reason: ENQUEUE_HOLDS_SLOT,
      message: `work root "${root.title}" already holds an implementing slot`,
    };
  }
  const blocker = firstBlockingEnqueueBlocker(
    root,
    issues,
    derived,
    byId,
    slotHolders,
  );
  if (blocker) {
    return {
      reason: "blocked",
      message: `Blocked by ${blocker.title}, so it must be queued after it`,
    };
  }
  return undefined;
}

/** Append a root at the back of its Project's queue. */
export function withQueueStamp(
  root: WorkRoot,
  issues: Issue[],
  byId: Map<string, Issue>,
  now: string,
): WorkRoot {
  const projectId = projectContaining(root, byId);
  if (!projectId) {
    throw new Error(`work root "${root.id}" has no project`);
  }
  return {
    ...root,
    workQueuedAt: now,
    workQueuePosition: nextQueuePosition(projectId, issues, byId),
    updatedAt: now,
  };
}

export interface WorkQueuePositionBackfillResult {
  updated: string[];
  skipped: boolean;
}

/**
 * One-time: roots that already carry `workQueuedAt` and no position get
 * positions in `workQueuedAt` order (id tie-break), per Project, after any
 * position already stored. Later calls no-op once the marker exists.
 */
export function ensureWorkQueuePositionsBackfilled(
  persistIssue: (issue: Issue) => void,
): WorkQueuePositionBackfillResult {
  if (existsSync(positionFlagPath())) return { updated: [], skipped: true };

  const onDisk = [...forEachOnDiskIssue()];
  const issues = onDisk.map((entry) => entry.issue);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const missingByProject = new Map<string, WorkRoot[]>();
  for (const { id, issue } of onDisk) {
    if (issue.id !== id) continue;
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    if (!issue.workQueuedAt || issue.workQueuePosition !== undefined) continue;
    const projectId = projectContaining(issue, byId);
    if (!projectId) continue;
    const bucket = missingByProject.get(projectId) ?? [];
    bucket.push(issue);
    missingByProject.set(projectId, bucket);
  }

  const updated: string[] = [];
  for (const [projectId, roots] of missingByProject) {
    roots.sort(compareWorkQueuedAtThenId);
    let position = nextQueuePosition(projectId, issues, byId);
    for (const root of roots) {
      persistIssue({ ...root, workQueuePosition: position });
      position += 1;
      updated.push(root.id);
    }
  }

  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(positionFlagPath(), "");
  return { updated, skipped: false };
}

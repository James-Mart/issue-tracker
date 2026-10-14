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

/** Clear both queue fields. A root leaves the queue only when both are gone. */
export function queueDeparturePatch(): IssuePatch {
  return { workQueuedAt: null, workQueuePosition: null };
}

function blockersOf(root: WorkRoot): string[] {
  return root.kind === "epic" ? root.blockedBy : [];
}

function nextQueuePosition(
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
 * in the queue (waiting, holding a slot, or joining in this same enqueue)
 * or its loop is finished (done, merged, or ready to land).
 */
const NO_ROOTS_JOINING = new Set<string>();

function blockerAllowsEnqueue(
  blockerId: string,
  byId: Map<string, Issue>,
  issues: Issue[],
  derived: ReturnType<typeof derive>,
  slotHolders: Set<string>,
  queuedNow: Set<string>,
): boolean {
  if (queuedNow.has(blockerId)) return true;
  const blocker = byId.get(blockerId);
  if (blocker?.kind !== "epic" && blocker?.kind !== "story") return false;
  if (blocker.workQueuedAt || slotHolders.has(blocker.id)) return true;
  return isWorkRootFinished(blocker, issues, derived.byId);
}

/**
 * First `blockedBy` root that is neither in the queue (waiting or holding a
 * slot) nor finished (done, merged, or ready to land). Manual enqueue refuses
 * that root; idea-archive enqueue leaves it unstamped.
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
    if (
      blockerAllowsEnqueue(
        blockerId,
        byId,
        issues,
        derived,
        slotHolders,
        NO_ROOTS_JOINING,
      )
    ) {
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

function enqueueOrder(
  candidates: WorkRoot[],
  allows: (blockerId: string, queuedNow: Set<string>) => boolean,
): WorkRoot[] {
  const queuedNow = new Set<string>();
  const ordered: WorkRoot[] = [];
  let pending = candidates;
  while (pending.length > 0) {
    const ready = pending.filter((root) =>
      blockersOf(root).every((id) => allows(id, queuedNow)),
    );
    if (ready.length === 0) {
      // A blocker outside the queue that has not finished holds these roots
      // and their dependents out. They stay unchanged, with no needsAttention.
      break;
    }
    for (const root of ready) {
      queuedNow.add(root.id);
      ordered.push(root);
    }
    const taken = new Set(ready.map((root) => root.id));
    pending = pending.filter((root) => !taken.has(root.id));
  }
  return ordered;
}

function workRootOf(
  planRootId: string,
  byId: Map<string, Issue>,
): WorkRoot | undefined {
  const issue = byId.get(planRootId);
  if (!issue) return undefined;
  if (issue.kind === "epic") return issue;
  if (issue.kind !== "story") return undefined;
  const parent = byId.get(issue.partOf);
  if (parent?.kind === "epic") return parent;
  if (parent?.kind === "project") return issue;
  return undefined;
}

/**
 * Stamp `workQueuedAt` and append `workQueuePosition` on each plan root's
 * work root when an auto-planned Idea archives. Roots already queued are
 * left as they are. Roots are ordered so each sits after its `blockedBy`
 * Epics. A root whose blocker is outside the queue and not finished is
 * left unchanged — not queued, and not marked needs-attention — and so is
 * every root that depends on it.
 */
export function planWorkQueueStamps(
  existing: Issue,
  patch: IssuePatch,
  issues: Issue[],
  now: string,
): Issue[] {
  if (existing.kind !== "idea" || existing.archived) return [];
  if (patch.archived !== true) return [];
  if (!existing.stakeholder) return [];
  if (existing.executionGate === true) return [];

  const derived = derive(issues);
  const planRoots = derived.byId[existing.id]?.planRoots ?? [];
  if (planRoots.length === 0) return [];

  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const project = byId.get(existing.partOf);
  const slotHolders =
    project?.kind === "project"
      ? slotHoldingRootIds(existing.partOf, {
          issues,
          derived: derived.byId,
          byId,
        })
      : new Set<string>();

  const seen = new Set<string>();
  const candidates: WorkRoot[] = [];
  for (const rootId of planRoots) {
    const workRoot = workRootOf(rootId, byId);
    if (!workRoot || workRoot.workQueuedAt || seen.has(workRoot.id)) continue;
    seen.add(workRoot.id);
    candidates.push(workRoot);
  }

  const ordered = enqueueOrder(candidates, (blockerId, queuedNow) =>
    blockerAllowsEnqueue(
      blockerId,
      byId,
      issues,
      derived,
      slotHolders,
      queuedNow,
    ),
  );

  let position = nextQueuePosition(existing.partOf, issues, byId);
  const stamped = new Map<string, Issue>();
  for (const root of ordered) {
    stamped.set(root.id, {
      ...root,
      workQueuedAt: now,
      workQueuePosition: position,
      updatedAt: now,
    });
    position += 1;
  }
  return [...stamped.values()];
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

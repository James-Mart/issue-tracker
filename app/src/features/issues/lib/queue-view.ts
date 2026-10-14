import type { DerivedState, IssueRecord } from "@server/schemas";
import { issuesById } from "./build-tree";
import {
  epicHasActivelyImplementingChild,
  isWorkRootFinished,
  storyIsActivelyImplementing,
} from "./derived";
import { formatElapsedCompact } from "./format-relative-updated-at";

export type QueueStage = "running" | "paused" | "waiting";

const QUEUE_BAND: Record<QueueStage, number> = {
  running: 0,
  paused: 1,
  waiting: 2,
};

type QueueItem = {
  issue: IssueRecord;
  state: DerivedState | undefined;
  queueStage?: QueueStage;
};

function isProjectWorkRoot(
  issue: IssueRecord,
  byId: Map<string, IssueRecord>,
): issue is IssueRecord & { kind: "epic" | "story" } {
  if (issue.kind !== "epic" && issue.kind !== "story") return false;
  return byId.get(issue.partOf)?.kind === "project";
}

function isRunning(state: DerivedState | undefined): boolean {
  if (state?.implementingLive) return true;
  return state?.liveRun === true && state.implementingOpen !== true;
}

function holdsImplementingSlot(
  issue: IssueRecord & { kind: "epic" | "story" },
  state: DerivedState | undefined,
): boolean {
  if (state?.implementingLive || state?.liveRun || state?.implementingOpen) {
    return true;
  }
  return Boolean(issue.workQueuedAt) && issue.needsAttention;
}

function activelyImplementing(
  issue: IssueRecord & { kind: "epic" | "story" },
  state: DerivedState | undefined,
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
): boolean {
  if (issue.kind === "story") {
    return storyIsActivelyImplementing(issue, state, issues);
  }
  return epicHasActivelyImplementingChild(issue.id, issues, derived);
}

/**
 * Where a work root sits in its Project queue.
 * Running and paused hold a slot. Waiting is queued and does not.
 * Null when the root is not in the queue.
 */
export function queueStage(
  issue: IssueRecord,
  state: DerivedState | undefined,
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
  byId: Map<string, IssueRecord> = issuesById(issues),
): QueueStage | null {
  if (!isProjectWorkRoot(issue, byId) || issue.archived) return null;
  if (isWorkRootFinished(issue, issues, derived)) return null;

  const running = isRunning(state);
  const waiting =
    Boolean(issue.workQueuedAt) &&
    !running &&
    !holdsImplementingSlot(issue, state);
  if (running) return "running";
  if (waiting) return "waiting";
  if (
    holdsImplementingSlot(issue, state) ||
    activelyImplementing(issue, state, issues, derived)
  ) {
    return "paused";
  }
  return null;
}

function queuePosition(issue: IssueRecord): number {
  if (issue.kind !== "epic" && issue.kind !== "story") {
    return Number.MAX_SAFE_INTEGER;
  }
  return issue.workQueuePosition ?? Number.MAX_SAFE_INTEGER;
}

function requireQueueStage(item: QueueItem): QueueStage {
  if (item.queueStage === undefined) {
    throw new Error(`queue item "${item.issue.id}" has no queue stage`);
  }
  return item.queueStage;
}

/** Running, then paused, then waiting by `workQueuePosition`. */
export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  const band =
    QUEUE_BAND[requireQueueStage(a)] - QUEUE_BAND[requireQueueStage(b)];
  if (band !== 0) return band;
  const position = queuePosition(a.issue) - queuePosition(b.issue);
  if (position !== 0) return position;
  return a.issue.id.localeCompare(b.issue.id);
}

/** Unlabeled elapsed time in queue (`12m`, `2h`). */
export function formatTimeInQueue(
  iso: string,
  nowMs: number = Date.now(),
): string {
  return formatElapsedCompact(iso, nowMs);
}

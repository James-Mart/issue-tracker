import type { DerivedState, IssueRecord } from "@server/schemas";
import { issuesById } from "./build-tree";
import { isWorkRootFinished } from "./derived";
import { formatElapsedCompact } from "./format-relative-updated-at";

export type QueueStage = "parked" | "running" | "paused" | "waiting";

const QUEUE_BAND: Record<QueueStage, number> = {
  parked: 0,
  running: 1,
  paused: 2,
  waiting: 3,
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

export function holdsImplementingSlot(
  issue: IssueRecord & { kind: "epic" | "story" },
  state: DerivedState | undefined,
): boolean {
  if (state?.implementingLive || state?.liveRun || state?.implementingOpen) {
    return true;
  }
  return Boolean(issue.workQueuedAt) && issue.needsAttention;
}

/**
 * Where a work root sits in its Project queue.
 * Parked is above the head and holds no slot. Running and paused hold a
 * slot. Waiting is queued and does not. Null when the root is not in the queue.
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
  if (issue.workParkedAt) return "parked";

  const running = isRunning(state);
  const waiting =
    Boolean(issue.workQueuedAt) &&
    !running &&
    !holdsImplementingSlot(issue, state);
  if (running) return "running";
  if (waiting) return "waiting";
  if (holdsImplementingSlot(issue, state)) return "paused";
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

function parkedAt(issue: IssueRecord): string {
  if (
    (issue.kind === "epic" || issue.kind === "story") &&
    issue.workParkedAt
  ) {
    return issue.workParkedAt;
  }
  throw new Error(`parked queue item "${issue.id}" has no workParkedAt`);
}

/** Parked, then running, then paused, then waiting by `workQueuePosition`. */
export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  const stageA = requireQueueStage(a);
  const stageB = requireQueueStage(b);
  const band = QUEUE_BAND[stageA] - QUEUE_BAND[stageB];
  if (band !== 0) return band;
  if (stageA === "parked") {
    const parked = parkedAt(a.issue).localeCompare(parkedAt(b.issue));
    if (parked !== 0) return parked;
    return a.issue.id.localeCompare(b.issue.id);
  }
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

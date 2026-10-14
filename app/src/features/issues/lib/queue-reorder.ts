import type { IssueRecord } from "@server/schemas";

export type QueueDropPlace = "before" | "after";

/** Drag chrome for a waiting queue row. Absent when the row is not reorderable. */
export interface QueueRowChrome {
  dragging: boolean;
  dropEdge?: QueueDropPlace;
  rowId: string;
  projectId: string;
}

export interface QueueRowBox {
  id: string;
  projectId: string;
  top: number;
  bottom: number;
}

/** How far a pointer may sit off a waiting row and still count as a drop. */
const QUEUE_DROP_SLACK_PX = 8;

/**
 * Index of `sourceId` in the waiting list after it is removed and reinserted.
 * `index` is that destination. Returns null when the list would not change.
 */
export function queueDestinationIndex(
  waitingIds: readonly string[],
  sourceId: string,
  targetId: string,
  place: QueueDropPlace,
): number | null {
  if (sourceId === targetId) return null;
  const sourceAt = waitingIds.indexOf(sourceId);
  if (sourceAt < 0 || !waitingIds.includes(targetId)) return null;
  const without = waitingIds.filter((id) => id !== sourceId);
  let index = without.indexOf(targetId);
  if (index < 0) return null;
  if (place === "after") index += 1;
  if (index === sourceAt) return null;
  return index;
}

/** Waiting ids with `sourceId` inserted at `index`. */
export function nextWaitingOrder(
  waitingIds: readonly string[],
  sourceId: string,
  index: number,
): string[] | null {
  if (!waitingIds.includes(sourceId)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= waitingIds.length) {
    return null;
  }
  const next = waitingIds.filter((id) => id !== sourceId);
  next.splice(index, 0, sourceId);
  return next;
}

/**
 * Reassign the waiting roots' existing position numbers onto `nextIds`.
 * Returns null when a root has no position or two share one, so the optimistic
 * patch is skipped and the settled refetch reconciles the cache. Also returns
 * null when the new order would not change any position.
 */
export function withWaitingOrder(
  issues: readonly IssueRecord[],
  nextIds: readonly string[],
): IssueRecord[] | null {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const positions: number[] = [];
  const seen = new Set<number>();
  for (const id of nextIds) {
    const issue = byId.get(id);
    if (!issue || (issue.kind !== "epic" && issue.kind !== "story")) return null;
    if (issue.workQueuePosition === undefined) return null;
    if (seen.has(issue.workQueuePosition)) return null;
    seen.add(issue.workQueuePosition);
    positions.push(issue.workQueuePosition);
  }
  positions.sort((a, b) => a - b);
  const assigned = new Map(nextIds.map((id, place) => [id, positions[place]]));
  let changed = false;
  const next = issues.map((issue) => {
    const position = assigned.get(issue.id);
    if (position === undefined) return issue;
    if (issue.kind !== "epic" && issue.kind !== "story") return issue;
    if (issue.workQueuePosition === position) return issue;
    changed = true;
    return { ...issue, workQueuePosition: position };
  });
  return changed ? next : null;
}

/**
 * Waiting row under the pointer, and whether the drop lands before or after
 * its midpoint. Null when the pointer is on the dragged row or off the band.
 */
export function queueDropFromRows(
  rows: readonly QueueRowBox[],
  y: number,
  sourceId: string,
  sourceProjectId: string,
): { targetId: string; place: QueueDropPlace } | null {
  let best: QueueRowBox | null = null;
  let bestDist = Infinity;
  for (const row of rows) {
    if (row.projectId !== sourceProjectId) continue;
    const contains = y >= row.top && y <= row.bottom;
    const dist = contains
      ? 0
      : Math.min(Math.abs(y - row.top), Math.abs(y - row.bottom));
    if (dist < bestDist) {
      best = row;
      bestDist = dist;
    }
  }
  if (!best || best.id === sourceId || bestDist > QUEUE_DROP_SLACK_PX) return null;
  const mid = (best.top + best.bottom) / 2;
  return { targetId: best.id, place: y < mid ? "before" : "after" };
}

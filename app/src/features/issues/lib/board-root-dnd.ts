import { isProjectBoardChild } from "@server/order";
import type { IssueRecord } from "@server/schemas";

/** Board-root rows (Epic / Idea / root project-level Story) are draggable. */
export function isBoardRootDraggable(issue: IssueRecord, issues: IssueRecord[]): boolean {
  const byId = new Map(issues.map((row) => [row.id, row]));
  return isProjectBoardChild(issue, byId);
}

/**
 * Dropping `sourceId` onto `targetId` should reorder board roots — not restack
 * (story→story) and not reparent an epic-child story onto an epic.
 */
export function canReorderBoardRoot(
  issues: IssueRecord[],
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return false;
  const byId = new Map(issues.map((row) => [row.id, row]));
  const source = byId.get(sourceId);
  const target = byId.get(targetId);
  if (!source || !target) return false;
  if (!isProjectBoardChild(source, byId) || !isProjectBoardChild(target, byId)) {
    return false;
  }
  if (source.partOf !== target.partOf) return false;
  // Story→story is restack, not board reorder.
  if (source.kind === "story" && target.kind === "story") return false;
  return true;
}

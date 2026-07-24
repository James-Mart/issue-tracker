import type { IssueRecord } from "@server/schemas";
import {
  canReorderBoardRoot,
  isBoardRootDraggable,
} from "./board-root-dnd";
import {
  canDropStoryOntoEpic,
  canDropStoryOntoProject,
  canRestackStoryOntoStory,
} from "./story-drop";

/** Stories are always tree-draggable (stack / reparent gestures). */
export function isStoryTreeDraggable(issue: IssueRecord): boolean {
  return issue.kind === "story";
}

/** Grab-cursor / `draggable` eligibility for a tree row. */
export function isRowDraggable(
  issue: IssueRecord,
  issues: IssueRecord[],
): boolean {
  return isStoryTreeDraggable(issue) || isBoardRootDraggable(issue, issues);
}

export type StoryDropAction = "restack" | "reparent" | "reorder";

/**
 * Core tree DnD gesture router: restack onto a story, reparent/unstack onto
 * epic/project, or board-root reorder (epic reorder beats reparent).
 */
export function resolveDropAction(
  issues: IssueRecord[],
  sourceId: string,
  targetId: string,
): StoryDropAction | null {
  const target = issues.find((issue) => issue.id === targetId);
  if (!target) return null;

  if (target.kind === "story") {
    return canRestackStoryOntoStory(issues, sourceId, targetId)
      ? "restack"
      : null;
  }

  if (target.kind === "project") {
    return canDropStoryOntoProject(issues, sourceId, targetId)
      ? "reparent"
      : null;
  }

  if (target.kind === "epic") {
    if (canReorderBoardRoot(issues, sourceId, targetId)) return "reorder";
    if (canDropStoryOntoEpic(issues, sourceId, targetId)) return "reparent";
    return null;
  }

  if (target.kind === "idea") {
    return canReorderBoardRoot(issues, sourceId, targetId) ? "reorder" : null;
  }

  return null;
}

/**
 * Shared drop handler: invoke `onMove` only when `sourceId` is present and
 * `canDrop` allows the gesture.
 */
export function processStoryDrop(params: {
  sourceId: string | null;
  targetId: string;
  canDrop: (sourceId: string) => boolean;
  onMove: (sourceId: string, targetId: string) => void;
}): void {
  const { sourceId, targetId, canDrop, onMove } = params;
  if (!sourceId) return;
  if (!canDrop(sourceId)) return;
  onMove(sourceId, targetId);
}

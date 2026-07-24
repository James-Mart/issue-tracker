import { stackedOnSubtree } from "@server/order";
import type { IssueRecord } from "@server/schemas";

export const STORY_DRAG_MIME = "application/x-issue-story";

type StoryRecord = Extract<IssueRecord, { kind: "story" }>;

function storiesOf(issues: IssueRecord[]): StoryRecord[] {
  return issues.filter((i): i is StoryRecord => i.kind === "story");
}

/** Dragged branch stack (root first); empty when `sourceId` is not a story. */
export function storyDragStack(
  issues: IssueRecord[],
  sourceId: string,
): StoryRecord[] {
  return stackedOnSubtree(storiesOf(issues), sourceId);
}

/** True when dropping `sourceId` onto branch `targetId` is a legal restack. */
export function canRestackStoryOntoStory(
  issues: IssueRecord[],
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return false;
  const stack = storyDragStack(issues, sourceId);
  if (stack.length === 0) return false;
  return !stack.some((b) => b.id === targetId);
}

/** True when dropping `sourceId` onto epic `epicId` is a legal reparent/unstack. */
export function canDropStoryOntoEpic(
  issues: IssueRecord[],
  sourceId: string,
  epicId: string,
): boolean {
  const stack = storyDragStack(issues, sourceId);
  if (stack.length === 0) return false;
  const epic = issues.find((i) => i.id === epicId);
  return epic?.kind === "epic";
}

/** True when dropping `sourceId` onto project `projectId` is a legal reparent/unstack. */
export function canDropStoryOntoProject(
  issues: IssueRecord[],
  sourceId: string,
  projectId: string,
): boolean {
  const stack = storyDragStack(issues, sourceId);
  if (stack.length === 0) return false;
  const project = issues.find((i) => i.id === projectId);
  return project?.kind === "project";
}

export function readStoryDragId(dataTransfer: DataTransfer): string | null {
  const id =
    dataTransfer.getData(STORY_DRAG_MIME) ||
    dataTransfer.getData("text/plain");
  return id || null;
}

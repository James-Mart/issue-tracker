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

function recordById(
  issues: IssueRecord[],
  id: string,
  byId?: ReadonlyMap<string, IssueRecord>,
): IssueRecord | undefined {
  return byId ? byId.get(id) : issues.find((issue) => issue.id === id);
}

/** True when dropping `sourceId` onto epic `epicId` is a legal reparent/unstack. */
export function canDropStoryOntoEpic(
  issues: IssueRecord[],
  sourceId: string,
  epicId: string,
  byId?: ReadonlyMap<string, IssueRecord>,
): boolean {
  const stack = storyDragStack(issues, sourceId);
  if (stack.length === 0) return false;
  return recordById(issues, epicId, byId)?.kind === "epic";
}

/** True when dropping `sourceId` onto project `projectId` is a legal reparent/unstack. */
export function canDropStoryOntoProject(
  issues: IssueRecord[],
  sourceId: string,
  projectId: string,
  byId?: ReadonlyMap<string, IssueRecord>,
): boolean {
  const stack = storyDragStack(issues, sourceId);
  if (stack.length === 0) return false;
  return recordById(issues, projectId, byId)?.kind === "project";
}

export function readStoryDragId(dataTransfer: DataTransfer): string | null {
  const id =
    dataTransfer.getData(STORY_DRAG_MIME) ||
    dataTransfer.getData("text/plain");
  return id || null;
}

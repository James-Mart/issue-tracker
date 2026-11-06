import { UPDATE_FROM_MERGE_BASE_TITLE } from "@server/issue-constants";

export function hasOpenUpdateFromMergeBaseTask(
  issues: readonly {
    kind: string;
    partOf?: string;
    title: string;
    status?: string;
  }[],
  storyId: string,
): boolean {
  return issues.some(
    (issue) =>
      issue.kind === "task" &&
      issue.partOf === storyId &&
      issue.title === UPDATE_FROM_MERGE_BASE_TITLE &&
      issue.status !== "done",
  );
}

export const ADD_IDEA_HELPER =
  "Creates an Idea whose plan appends tasks to this Story — for example PR feedback after review. Planning it adds tasks here instead of opening a new root Story.";

export function appendIdeaTitle(storyTitle: string): string {
  return `Append to ${storyTitle}`;
}

export function storyAppendActions(story: {
  merged: boolean;
  branchName?: string;
  hasOpenMergeBaseTask?: boolean;
}): { addIdea: boolean; updateFromMergeBase: boolean } {
  if (story.merged) {
    return { addIdea: false, updateFromMergeBase: false };
  }
  if (!story.branchName) {
    return { addIdea: true, updateFromMergeBase: false };
  }
  if (story.hasOpenMergeBaseTask) {
    return { addIdea: true, updateFromMergeBase: false };
  }
  return { addIdea: true, updateFromMergeBase: true };
}

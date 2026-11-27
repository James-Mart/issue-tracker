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
  "Creates an Idea in this Story's Project. Planning it opens a new root.";

export function followUpIdeaTitle(storyTitle: string): string {
  return `Follow-up to ${storyTitle}`;
}

export function storyAppendActions(story: {
  merged: boolean;
  branchName?: string;
  hasOpenMergeBaseTask?: boolean;
}): { addIdea: boolean; updateFromMergeBase: boolean } {
  if (story.merged) {
    return { addIdea: false, updateFromMergeBase: false };
  }
  return {
    addIdea: true,
    updateFromMergeBase: Boolean(story.branchName && !story.hasOpenMergeBaseTask),
  };
}

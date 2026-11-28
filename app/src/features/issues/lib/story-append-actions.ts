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

export const AMEND_OUTLINE_HELPER =
  "Opens a planning session on this Story's outline.";

export function followUpIdeaTitle(storyTitle: string): string {
  return `Follow-up to ${storyTitle}`;
}

/** Follow-up on an unmerged Story: amend its outline, or create an Idea. */
export function storyFollowUpMode(story: {
  merged: boolean;
  sourceOutline?: { outline: string };
}): "amend-outline" | "idea" | "none" {
  if (story.merged) return "none";
  if (story.sourceOutline) return "amend-outline";
  return "idea";
}

export function storyAppendActions(story: {
  merged: boolean;
  branchName?: string;
  hasOpenMergeBaseTask?: boolean;
  sourceOutline?: { outline: string };
}): { addIdea: boolean; amendOutline: boolean; updateFromMergeBase: boolean } {
  const followUp = storyFollowUpMode(story);
  if (followUp === "none") {
    return { addIdea: false, amendOutline: false, updateFromMergeBase: false };
  }
  return {
    addIdea: followUp === "idea",
    amendOutline: followUp === "amend-outline",
    updateFromMergeBase: Boolean(story.branchName && !story.hasOpenMergeBaseTask),
  };
}

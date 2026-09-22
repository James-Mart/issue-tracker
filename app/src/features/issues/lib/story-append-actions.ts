import { UPDATE_FROM_MERGE_BASE_TITLE } from "@server/issue-constants";

export const MERGED_APPEND_REASON =
  "This Story is merged — appending tasks is not allowed. Post-landing work belongs in a new Story.";

export const NO_BRANCH_MERGE_BASE_REASON =
  "This Story has no branch yet. Start implementation before merging from the merge base.";

export const OPEN_MERGE_BASE_TASK_REASON =
  "An update from the merge base is already on this Story.";

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

export function mergeBaseHelper(
  mergeBase: string,
  branchName: string,
): string {
  return `Appends one predefined task to merge ${mergeBase} into ${branchName} and reconcile conflicts.`;
}

export function appendIdeaTitle(storyTitle: string): string {
  return `Append to ${storyTitle}`;
}

export function storyAppendAvailability(story: {
  merged: boolean;
  branchName?: string;
  hasOpenMergeBaseTask?: boolean;
}): {
  ideaEnabled: boolean;
  mergeBaseEnabled: boolean;
  cardReason?: string;
  mergeBaseReason?: string;
} {
  if (story.merged) {
    return {
      ideaEnabled: false,
      mergeBaseEnabled: false,
      cardReason: MERGED_APPEND_REASON,
    };
  }
  if (!story.branchName) {
    return {
      ideaEnabled: true,
      mergeBaseEnabled: false,
      mergeBaseReason: NO_BRANCH_MERGE_BASE_REASON,
    };
  }
  if (story.hasOpenMergeBaseTask) {
    return {
      ideaEnabled: true,
      mergeBaseEnabled: false,
      mergeBaseReason: OPEN_MERGE_BASE_TASK_REASON,
    };
  }
  return { ideaEnabled: true, mergeBaseEnabled: true };
}

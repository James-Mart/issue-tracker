export const MERGED_APPEND_REASON =
  "This Story is merged — appending tasks is not allowed. Post-landing work belongs in a new Story.";

export const NO_BRANCH_MERGE_BASE_REASON =
  "This Story has no branch yet. Start implementation before merging from the merge base.";

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
  return { ideaEnabled: true, mergeBaseEnabled: true };
}

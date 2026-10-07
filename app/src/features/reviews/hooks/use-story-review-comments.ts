import { useCommentsQuery, useCommentThreads } from "@/features/issues/api/queries";

/** Child panels reuse the comments read the story review page already started. */
const reuseStoryComments = { refetchOnMount: false } as const;

export function useStoryReviewCommentsQuery(storyId: string) {
  return useCommentsQuery(storyId, reuseStoryComments);
}

export function useStoryReviewCommentThreads(storyId: string) {
  return useCommentThreads(storyId, reuseStoryComments);
}

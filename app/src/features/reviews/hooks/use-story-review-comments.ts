import {
  reuseMountedRead,
  useCommentsQuery,
  useReuseCommentThreads,
} from "@/features/issues/api/queries";

/** Child panels reuse the comments read the story review page already started. */
export function useStoryReviewCommentsQuery(storyId: string) {
  return useCommentsQuery(storyId, reuseMountedRead);
}

export function useStoryReviewCommentThreads(storyId: string) {
  return useReuseCommentThreads(storyId);
}

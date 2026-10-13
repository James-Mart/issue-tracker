import {
  reuseMountedRead,
  useCommentsQuery,
  useReuseCommentThreads,
} from "@/features/issues/api/queries";

/** Child panels reuse the review comments read the story review page already started. */
export function useReviewCommentsQuery(reviewId: string) {
  return useCommentsQuery(reviewId, reuseMountedRead);
}

export function useReviewCommentThreads(reviewId: string) {
  return useReuseCommentThreads(reviewId);
}

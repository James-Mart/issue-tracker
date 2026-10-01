import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ReviewView, SetReviewMarkBody } from "@server/schemas";
import {
  postArchiveReview,
  postOpenReview,
  postReopenReview,
  postRetryOpenReviewSubmissions,
  postSubmitReview,
  putReviewMark,
} from "./client";
import { reviewKeys } from "./keys";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

function useReviewMutation<TVariables>(
  projectId: string,
  mutationFn: (variables: TVariables) => Promise<ReviewView>,
) {
  const qc = useQueryClient();
  return useMutation<ReviewView, Error, TVariables>({
    mutationFn,
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (review) => {
      qc.setQueryData(reviewKeys.detail(projectId, review.id), review);
      // A list that was never fetched stays uncached; the onSettled invalidation fills it.
      qc.setQueriesData<{ reviews: ReviewView[] }>(
        { queryKey: reviewKeys.lists(projectId) },
        (list) =>
          list && {
            reviews: list.reviews.map((entry) =>
              entry.id === review.id ? review : entry,
            ),
          },
      );
    },
    // Review writes never change a diff or the commit list, so only records refetch.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: reviewKeys.lists(projectId) });
      qc.invalidateQueries({ queryKey: reviewKeys.details() });
    },
  });
}

export function useOpenReview(projectId: string) {
  return useReviewMutation(projectId, (storyId: string) =>
    postOpenReview(projectId, storyId),
  );
}

export function useArchiveReview(projectId: string) {
  return useReviewMutation(projectId, (reviewId: string) =>
    postArchiveReview(projectId, reviewId),
  );
}

export function useReopenReview(projectId: string) {
  return useReviewMutation(projectId, (reviewId: string) =>
    postReopenReview(projectId, reviewId),
  );
}

export function useSubmitReview(projectId: string) {
  return useReviewMutation(
    projectId,
    ({ reviewId, summary }: { reviewId: string; summary?: string }) =>
      postSubmitReview(projectId, reviewId, summary),
  );
}

export function useRetryOpenReviewSubmissions(projectId: string) {
  return useReviewMutation(projectId, (reviewId: string) =>
    postRetryOpenReviewSubmissions(projectId, reviewId),
  );
}

export function useSetReviewMark(projectId: string) {
  return useReviewMutation(
    projectId,
    ({ reviewId, ...body }: SetReviewMarkBody & { reviewId: string }) =>
      putReviewMark(projectId, reviewId, body),
  );
}

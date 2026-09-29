import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ReviewView, SetReviewMarkBody } from "@server/schemas";
import {
  postArchiveReview,
  postOpenReview,
  postReopenReview,
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
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: reviewKeys.all });
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

export function useSetReviewMark(projectId: string) {
  return useReviewMutation(
    projectId,
    ({ reviewId, ...body }: SetReviewMarkBody & { reviewId: string }) =>
      putReviewMark(projectId, reviewId, body),
  );
}

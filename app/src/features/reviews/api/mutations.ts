import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  ReviewRecordView,
  ReviewRuntimeStatus,
  ReviewView,
  SetReviewMarkBody,
  SetStandardsProposalBody,
  SubmitReviewBody,
} from "@server/schemas";
import {
  deleteReviewRuntime,
  patchStandardsProposal,
  postArchiveReview,
  postOpenReview,
  postOpenReviewFromPr,
  postReopenReview,
  postRetryOpenReviewSubmissions,
  postRetryStandardsAssessment,
  postReviewRuntime,
  postSubmitReview,
  postSubmitStandardsGroup,
  postSyncReviewWorktree,
  putReviewMark,
} from "./client";
import { reviewKeys } from "./keys";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

function useReviewMutation<TVariables>(
  projectId: string,
  mutationFn: (variables: TVariables) => Promise<ReviewView>,
  scope?: { id: string },
) {
  const qc = useQueryClient();
  return useMutation<ReviewView, Error, TVariables>({
    mutationFn,
    scope,
    onError: (err) => toast.error(messageOf(err)),
    onSuccess: (review) => {
      const { progress, ...record } = review;
      qc.setQueryData(reviewKeys.detail(projectId, review.id), review);
      qc.setQueryData(reviewKeys.progress(projectId, review.id), progress);
      // A list that was never fetched stays uncached; the onSettled invalidation fills it.
      qc.setQueriesData<{ reviews: ReviewRecordView[] }>(
        { queryKey: reviewKeys.lists(projectId) },
        (list) =>
          list && {
            reviews: list.reviews.map((entry) =>
              entry.id === review.id ? record : entry,
            ),
          },
      );
    },
    // Review writes never change a diff or the commit list, so only records refetch.
    onSettled: (review) => {
      qc.invalidateQueries({ queryKey: reviewKeys.lists(projectId) });
      qc.invalidateQueries({ queryKey: reviewKeys.details() });
      if (review) {
        qc.invalidateQueries({ queryKey: reviewKeys.progress(projectId, review.id) });
      }
    },
  });
}

export function useOpenReview(projectId: string) {
  return useReviewMutation(projectId, (storyId: string) =>
    postOpenReview(projectId, storyId),
  );
}

export function useOpenReviewFromPr(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pr: string) => postOpenReviewFromPr(projectId, pr),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reviewKeys.lists(projectId) });
    },
  });
}

export function useSyncReviewWorktree(projectId: string) {
  return useReviewMutation(projectId, (reviewId: string) =>
    postSyncReviewWorktree(projectId, reviewId),
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
    ({ reviewId, ...body }: SubmitReviewBody & { reviewId: string }) =>
      postSubmitReview(projectId, reviewId, body),
  );
}

export function useRetryOpenReviewSubmissions(projectId: string) {
  return useReviewMutation(projectId, (reviewId: string) =>
    postRetryOpenReviewSubmissions(projectId, reviewId),
  );
}

/** One group's proposal writes and Submit run in order, so Submit lands after a save sent before it. */
function standardsGroupScope(submissionId: string) {
  return { id: `standards-group:${submissionId}` };
}

export type StandardsProposalTarget = {
  reviewId: string;
  proposalId: string;
};

export function useSetStandardsProposal(projectId: string, submissionId: string) {
  return useReviewMutation(
    projectId,
    ({ reviewId, proposalId, ...body }: SetStandardsProposalBody & StandardsProposalTarget) =>
      patchStandardsProposal(projectId, reviewId, submissionId, proposalId, body),
    standardsGroupScope(submissionId),
  );
}

export function useSubmitStandardsGroup(projectId: string, submissionId: string) {
  return useReviewMutation(
    projectId,
    (reviewId: string) => postSubmitStandardsGroup(projectId, reviewId, submissionId),
    standardsGroupScope(submissionId),
  );
}

export function useRetryStandardsAssessment(projectId: string) {
  return useReviewMutation(
    projectId,
    ({ reviewId, submissionId }: { reviewId: string; submissionId: string }) =>
      postRetryStandardsAssessment(projectId, reviewId, submissionId),
  );
}

function useRuntimeMutation(
  projectId: string,
  reviewId: string,
  mutationFn: () => Promise<ReviewRuntimeStatus>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (status) => {
      qc.setQueryData(reviewKeys.runtime(reviewId), status);
      qc.invalidateQueries({ queryKey: reviewKeys.detail(projectId, reviewId) });
    },
    onError: (err) => toast.error(messageOf(err)),
  });
}

export function useStartReviewRuntime(projectId: string, reviewId: string) {
  return useRuntimeMutation(projectId, reviewId, () => postReviewRuntime(reviewId));
}

export function useStopReviewRuntime(projectId: string, reviewId: string) {
  return useRuntimeMutation(projectId, reviewId, () => deleteReviewRuntime(reviewId));
}

export function useSetReviewMark(projectId: string) {
  return useReviewMutation(
    projectId,
    ({ reviewId, ...body }: SetReviewMarkBody & { reviewId: string }) =>
      putReviewMark(projectId, reviewId, body),
  );
}

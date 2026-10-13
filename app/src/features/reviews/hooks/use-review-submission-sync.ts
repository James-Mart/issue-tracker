import { useEffect, useRef } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ReviewView } from "@server/schemas";
import { issuesKeys } from "@/features/issues/api/keys";
import { useReviewQuery } from "../api/queries";
import { submissionPollInterval } from "../lib/review-submission-ui";

function submissionSignature(
  submissions: readonly { id: string; status: string }[],
): string {
  return submissions.map((submission) => `${submission.id}:${submission.status}`).join("\n");
}

/**
 * After a submission status change, refresh comments and the issue list so the
 * summary, linked Tasks, and new Tasks show up. The first observation is the
 * loaded record, not a change.
 */
function useReviewSubmissionFollowUp(
  reviewId: string | undefined,
  submissions: readonly { id: string; status: string }[] | undefined,
): void {
  const qc = useQueryClient();
  const seen = useRef<string | undefined>(undefined);
  const signature = submissions ? submissionSignature(submissions) : undefined;

  useEffect(() => {
    if (signature === undefined) return;
    const prior = seen.current;
    seen.current = signature;
    if (prior === undefined || prior === signature || reviewId === undefined) return;
    void qc.invalidateQueries({ queryKey: issuesKeys.comments(reviewId) });
    void qc.invalidateQueries({ queryKey: issuesKeys.list() });
  }, [qc, reviewId, signature]);
}

/** Review issue. Polls while a submission is tasking, then refreshes follow-on reads. */
export function useReviewRecord(
  projectId: string,
  reviewId: string,
): UseQueryResult<ReviewView, Error> {
  const review = useReviewQuery(projectId, reviewId, {
    refetchInterval: (query) => submissionPollInterval(query.state.data?.submissions),
  });
  useReviewSubmissionFollowUp(reviewId, review.data?.submissions);
  return review;
}

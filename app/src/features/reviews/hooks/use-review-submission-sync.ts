import { useEffect, useRef } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ReviewView } from "@server/schemas";
import { issuesKeys } from "@/features/issues/api/keys";
import { fetchReview } from "../api/client";
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

export type ReviewRecordRead = {
  review: UseQueryResult<ReviewView, Error>;
  /** The open-time pull-request refresh for this review has succeeded. */
  headSynced: boolean;
};

/**
 * Review issue for the workbench. The first fetch of each review follows its
 * pull request head; later polls, including while a submission is tasking,
 * read the stored review.
 */
export function useReviewRecord(projectId: string, reviewId: string): ReviewRecordRead {
  const identity = `${projectId}\0${reviewId}`;
  const identityRef = useRef(identity);
  const generation = useRef(0);
  const consumed = useRef(-1);
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    generation.current += 1;
  }
  const review = useReviewQuery(projectId, reviewId, {
    refetchInterval: (query) => submissionPollInterval(query.state.data?.submissions),
    queryFn: async () => {
      const generationAtStart = generation.current;
      const refresh = consumed.current !== generationAtStart;
      const view = await fetchReview(projectId, reviewId, { refreshHead: refresh });
      // A fetch that outlives navigation must not consume the next review's open refresh.
      if (refresh && generation.current === generationAtStart) {
        consumed.current = generationAtStart;
      }
      return view;
    },
  });
  useReviewSubmissionFollowUp(reviewId, review.data?.submissions);
  return { review, headSynced: consumed.current === generation.current };
}

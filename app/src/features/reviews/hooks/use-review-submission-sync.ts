import { useEffect, useRef } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ReviewRecordView } from "@server/schemas";
import { issuesKeys } from "@/features/issues/api/keys";
import { useReviewsQuery } from "../api/queries";
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
  storyId: string,
  submissions: readonly { id: string; status: string }[] | undefined,
): void {
  const qc = useQueryClient();
  const seen = useRef<string | undefined>(undefined);
  const signature = submissions ? submissionSignature(submissions) : undefined;

  useEffect(() => {
    if (signature === undefined) return;
    const prior = seen.current;
    seen.current = signature;
    if (prior === undefined || prior === signature) return;
    void qc.invalidateQueries({ queryKey: issuesKeys.comments(storyId) });
    void qc.invalidateQueries({ queryKey: issuesKeys.list() });
  }, [qc, signature, storyId]);
}

/** Story review list. Polls while a submission is tasking, then refreshes follow-on reads. */
export function useStoryReviewList(
  projectId: string,
  storyId: string,
): UseQueryResult<{ reviews: ReviewRecordView[] }, Error> {
  const reviews = useReviewsQuery(projectId, storyId, {
    refetchInterval: (query) =>
      submissionPollInterval(query.state.data?.reviews[0]?.submissions),
  });
  useReviewSubmissionFollowUp(
    storyId,
    reviews.data ? reviews.data.reviews[0]?.submissions : undefined,
  );
  return reviews;
}

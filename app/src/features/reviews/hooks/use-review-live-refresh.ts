import { useEffect, useRef } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { ReviewCommits } from "@server/schemas";
import { reviewKeys } from "../api/keys";
import { useReviewCommitsQuery } from "../api/queries";

export const REVIEW_COMMITS_POLL_MS = 10_000;

/**
 * Poll the story's commits once a review id is known. When the tip moves,
 * refetch every scope's diff, the review records, and progress so
 * changed-since marks follow.
 */
export function useReviewLiveRefresh(
  projectId: string,
  storyId: string,
  reviewId: string | undefined,
): UseQueryResult<ReviewCommits, Error> {
  const qc = useQueryClient();
  const commits = useReviewCommitsQuery(projectId, storyId, {
    refetchInterval: reviewId ? REVIEW_COMMITS_POLL_MS : false,
  });
  const tip = commits.data?.tip;
  const seenTip = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (tip === undefined) return;
    const previous = seenTip.current;
    seenTip.current = tip;
    if (previous === undefined || previous === tip) return;
    void qc.invalidateQueries({ queryKey: reviewKeys.diffs(projectId, storyId) });
    void qc.invalidateQueries({ queryKey: reviewKeys.lists(projectId) });
    if (!reviewId) return;
    void qc.invalidateQueries({ queryKey: reviewKeys.detail(projectId, reviewId) });
    void qc.invalidateQueries({ queryKey: reviewKeys.progress(projectId, reviewId) });
  }, [projectId, qc, reviewId, storyId, tip]);

  return commits;
}

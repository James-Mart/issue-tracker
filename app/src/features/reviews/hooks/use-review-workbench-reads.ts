import { useSearchParams } from "react-router-dom";
import { useReviewDiffQuery } from "../api/queries";
import { resolveReviewScope } from "../lib/review-scope";
import { resolveReviewWorkbenchTab } from "../lib/workbench-tabs";
import { useReviewLiveRefresh } from "./use-review-live-refresh";
import { useReviewRecord } from "./use-review-submission-sync";
import { useReviewCommentsQuery } from "./use-review-comments";

/** Diff-tab scope from the URL, before the commit list can rewrite a shared link. */
function diffTabScope(searchParams: URLSearchParams): string | null {
  if (resolveReviewWorkbenchTab(searchParams.get("tab")) !== "diff") return null;
  return resolveReviewScope(searchParams.get("scope"), undefined);
}

/**
 * The review issue, its comments, commits, and (on the diff tab) the diff.
 * A Story source reads the Story range. A pull-request-only review reads
 * `baseRef...headSha` from the review.
 */
export function useReviewWorkbenchReads(projectId: string, reviewId: string) {
  const [searchParams] = useSearchParams();
  const review = useReviewRecord(projectId, reviewId);
  const storyId = review.data?.story ?? "";
  const known = review.data !== undefined;
  useReviewCommentsQuery(reviewId);
  const commits = useReviewLiveRefresh(projectId, storyId, known ? reviewId : undefined);
  useReviewDiffQuery(projectId, storyId, diffTabScope(searchParams), {
    enabled: known,
    reviewId: storyId ? undefined : reviewId,
  });
  return { review, commits };
}

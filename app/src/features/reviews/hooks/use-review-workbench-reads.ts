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
 * The review issue, its comments, the Story's commits, and (on the diff tab)
 * the diff. Commits and the diff wait until the review names its Story.
 */
export function useReviewWorkbenchReads(projectId: string, reviewId: string) {
  const [searchParams] = useSearchParams();
  const review = useReviewRecord(projectId, reviewId);
  const storyId = review.data?.story ?? "";
  useReviewCommentsQuery(reviewId);
  const commits = useReviewLiveRefresh(projectId, storyId, reviewId);
  useReviewDiffQuery(projectId, storyId, diffTabScope(searchParams), {
    enabled: storyId.length > 0,
  });
  return { review, commits };
}

import { useSearchParams } from "react-router-dom";
import { useReviewDiffQuery } from "../api/queries";
import { isPullRequestOnlyReview, pullRequestHeadSha } from "../lib/pull-request-head";
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
  const { review, headSynced } = useReviewRecord(projectId, reviewId);
  const storyId = review.data?.story ?? "";
  const prOnly = review.data !== undefined && isPullRequestOnlyReview(review.data);
  const readsReady = review.data !== undefined && (!prOnly || headSynced);
  const headSha = readsReady && review.data ? pullRequestHeadSha(storyId, review.data) : undefined;
  useReviewCommentsQuery(reviewId);
  const commits = useReviewLiveRefresh(
    projectId,
    storyId,
    readsReady ? reviewId : undefined,
    headSha,
  );
  useReviewDiffQuery(projectId, storyId, diffTabScope(searchParams), {
    enabled: readsReady,
    reviewId: storyId ? undefined : readsReady ? reviewId : undefined,
    headSha,
  });
  return { review, commits, readsReady };
}

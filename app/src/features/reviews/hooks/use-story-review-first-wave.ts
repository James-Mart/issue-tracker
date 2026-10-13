import { useSearchParams } from "react-router-dom";
import { useReviewDiffQuery } from "../api/queries";
import { resolveReviewScope } from "../lib/review-scope";
import { resolveReviewWorkbenchTab } from "../lib/workbench-tabs";
import { useReviewLiveRefresh } from "./use-review-live-refresh";
import { useStoryReviewList } from "./use-review-submission-sync";
import { useReviewCommentsQuery } from "./use-review-comments";

/** Diff-tab scope from the URL, before the commit list can rewrite a shared link. */
function diffTabScope(searchParams: URLSearchParams): string | null {
  if (resolveReviewWorkbenchTab(searchParams.get("tab")) !== "diff") return null;
  return resolveReviewScope(searchParams.get("scope"), undefined);
}

/**
 * Commits and (on the diff tab) the diff, keyed by story id so they start with
 * the reviews list; review comments start once the list names the review.
 */
export function useStoryReviewFirstWave(projectId: string, storyId: string) {
  const [searchParams] = useSearchParams();
  const reviews = useStoryReviewList(projectId, storyId);
  const reviewId = reviews.data?.reviews[0]?.id;
  useReviewCommentsQuery(reviewId ?? "");
  const commits = useReviewLiveRefresh(projectId, storyId, reviewId);
  useReviewDiffQuery(projectId, storyId, diffTabScope(searchParams));
  return { reviews, commits };
}

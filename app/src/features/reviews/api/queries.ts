import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";
import type { ReviewCommits, ReviewDiff, ReviewView } from "@server/schemas";
import {
  fetchReview,
  fetchReviewCommits,
  fetchReviewDiff,
  fetchReviews,
} from "./client";
import { reviewKeys } from "./keys";

function retryRead(count: number, error: Error): boolean {
  return (
    !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
    count < 2
  );
}

export function useReviewsQuery(
  projectId: string,
  storyId?: string,
): UseQueryResult<{ reviews: ReviewView[] }, Error> {
  return useQuery({
    queryKey: reviewKeys.list(projectId, storyId),
    queryFn: () => fetchReviews(projectId, storyId),
    enabled: Boolean(projectId),
    retry: retryRead,
  });
}

export function useReviewQuery(
  projectId: string,
  reviewId: string,
): UseQueryResult<ReviewView, Error> {
  return useQuery({
    queryKey: reviewKeys.detail(projectId, reviewId),
    queryFn: () => fetchReview(projectId, reviewId),
    enabled: Boolean(projectId) && Boolean(reviewId),
    retry: retryRead,
  });
}

export function useReviewCommitsQuery(
  projectId: string,
  reviewId: string,
): UseQueryResult<ReviewCommits, Error> {
  return useQuery({
    queryKey: reviewKeys.commits(projectId, reviewId),
    queryFn: () => fetchReviewCommits(projectId, reviewId),
    enabled: Boolean(projectId) && Boolean(reviewId),
    retry: retryRead,
  });
}

export function useReviewDiffQuery(
  projectId: string,
  reviewId: string,
  scope: string,
): UseQueryResult<ReviewDiff, Error> {
  return useQuery({
    queryKey: reviewKeys.diff(projectId, reviewId, scope),
    queryFn: () => fetchReviewDiff(projectId, reviewId, scope),
    enabled: Boolean(projectId) && Boolean(reviewId) && Boolean(scope),
    retry: retryRead,
  });
}

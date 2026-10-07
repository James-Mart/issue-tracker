import { useQuery, type Query, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";
import type {
  ReviewCandidates,
  ReviewCommits,
  ReviewDiff,
  ReviewProgress,
  ReviewRecordView,
  ReviewView,
} from "@server/schemas";
import {
  fetchReview,
  fetchReviewCandidates,
  fetchReviewCommits,
  fetchReviewDiff,
  fetchReviewProgress,
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
  options: {
    enabled?: boolean;
    refetchInterval?:
      | number
      | false
      | ((
          query: Query<{ reviews: ReviewRecordView[] }, Error>,
        ) => number | false | undefined);
  } = {},
): UseQueryResult<{ reviews: ReviewRecordView[] }, Error> {
  return useQuery({
    queryKey: reviewKeys.list(projectId, storyId),
    queryFn: () => fetchReviews(projectId, storyId),
    enabled: (options.enabled ?? true) && Boolean(projectId),
    retry: retryRead,
    refetchInterval: options.refetchInterval,
  });
}

export function useReviewProgressQuery(
  projectId: string,
  reviewId: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<ReviewProgress, Error> {
  return useQuery({
    queryKey: reviewKeys.progress(projectId, reviewId),
    queryFn: () => fetchReviewProgress(projectId, reviewId),
    enabled: (options.enabled ?? true) && Boolean(projectId) && Boolean(reviewId),
    retry: retryRead,
  });
}

export function useReviewCandidatesQuery(
  projectId: string,
  query: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<ReviewCandidates, Error> {
  return useQuery({
    queryKey: reviewKeys.candidates(projectId, query),
    queryFn: () => fetchReviewCandidates(projectId, query),
    enabled: (options.enabled ?? true) && Boolean(projectId),
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
  options: { refetchInterval?: number } = {},
): UseQueryResult<ReviewCommits, Error> {
  return useQuery({
    queryKey: reviewKeys.commits(projectId, reviewId),
    queryFn: () => fetchReviewCommits(projectId, reviewId),
    enabled: Boolean(projectId) && Boolean(reviewId),
    retry: retryRead,
    refetchInterval: options.refetchInterval,
  });
}

export function useReviewDiffQuery(
  projectId: string,
  reviewId: string,
  scope: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<ReviewDiff, Error> {
  return useQuery({
    queryKey: reviewKeys.diff(projectId, reviewId, scope),
    queryFn: () => fetchReviewDiff(projectId, reviewId, scope),
    enabled:
      (options.enabled ?? true) &&
      Boolean(projectId) &&
      Boolean(reviewId) &&
      Boolean(scope),
    retry: retryRead,
  });
}

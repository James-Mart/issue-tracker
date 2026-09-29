import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";
import type { ReviewView } from "@server/schemas";
import { fetchReview, fetchReviews } from "./client";
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

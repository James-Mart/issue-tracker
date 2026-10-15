import { skipToken, useQuery, type Query, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/errors";
import type {
  ReviewAgentRun,
  ReviewCandidates,
  ReviewCommits,
  ReviewDiff,
  ReviewProgress,
  ReviewRecordView,
  ReviewRuntimeStatus,
  ReviewView,
} from "@server/schemas";
import {
  fetchReview,
  fetchReviewAgentRuns,
  fetchReviewCandidates,
  fetchReviewCommits,
  fetchReviewDiff,
  fetchReviewProgress,
  fetchReviewRecordCommits,
  fetchReviewRecordDiff,
  fetchReviewRuntime,
  fetchReviews,
} from "./client";
import { reviewAgentRunsRefetchInterval } from "../lib/review-agent-runs";
import { reviewKeys } from "./keys";

function retryReviewRead(count: number, error: Error): boolean {
  return (
    !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
    count < 2
  );
}

type RefetchInterval<TData> =
  | number
  | false
  | ((query: Query<TData, Error>) => number | false | undefined);

export function useReviewsQuery(
  projectId: string,
  storyId?: string,
  options: {
    enabled?: boolean;
    refetchInterval?: RefetchInterval<{ reviews: ReviewRecordView[] }>;
  } = {},
): UseQueryResult<{ reviews: ReviewRecordView[] }, Error> {
  return useQuery({
    queryKey: reviewKeys.list(projectId, storyId),
    queryFn: () => fetchReviews(projectId, storyId),
    enabled: (options.enabled ?? true) && Boolean(projectId),
    retry: retryReviewRead,
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
    retry: retryReviewRead,
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
    retry: retryReviewRead,
  });
}

export function useReviewQuery(
  projectId: string,
  reviewId: string,
  options: {
    refetchInterval?: RefetchInterval<ReviewView>;
    queryFn?: () => Promise<ReviewView>;
  } = {},
): UseQueryResult<ReviewView, Error> {
  return useQuery({
    queryKey: reviewKeys.detail(projectId, reviewId),
    queryFn: options.queryFn ?? (() => fetchReview(projectId, reviewId)),
    enabled: Boolean(projectId) && Boolean(reviewId),
    retry: retryReviewRead,
    refetchInterval: options.refetchInterval,
  });
}

/** Story commits when `storyId` is set; otherwise the review's own range. */
function reviewChangeRead(
  storyId: string,
  reviewId: string | undefined,
): { reviewId: string } | { storyId: string } | undefined {
  if (storyId) return { storyId };
  if (reviewId) return { reviewId };
  return undefined;
}

export function useReviewCommitsQuery(
  projectId: string,
  storyId: string,
  options: { refetchInterval?: number | false; reviewId?: string; headSha?: string } = {},
): UseQueryResult<ReviewCommits, Error> {
  const read = reviewChangeRead(storyId, options.reviewId);
  return useQuery({
    queryKey:
      read && "reviewId" in read
        ? reviewKeys.reviewCommits(projectId, read.reviewId, options.headSha)
        : reviewKeys.commits(projectId, storyId),
    queryFn: () =>
      read && "reviewId" in read
        ? fetchReviewRecordCommits(projectId, read.reviewId)
        : fetchReviewCommits(projectId, storyId),
    enabled: Boolean(projectId) && read !== undefined,
    retry: retryReviewRead,
    refetchInterval: options.refetchInterval,
  });
}

export function useReviewDiffQuery(
  projectId: string,
  storyId: string,
  scope: string | null,
  options: { enabled?: boolean; reviewId?: string; headSha?: string } = {},
): UseQueryResult<ReviewDiff, Error> {
  const read = reviewChangeRead(storyId, options.reviewId);
  const ready = scope !== null && (options.enabled ?? true) && Boolean(projectId) && read !== undefined;
  return useQuery({
    queryKey:
      read && "reviewId" in read
        ? reviewKeys.reviewDiff(projectId, read.reviewId, scope ?? "", options.headSha)
        : reviewKeys.diff(projectId, storyId, scope ?? ""),
    queryFn:
      scope !== null && ready && read
        ? () =>
            "reviewId" in read
              ? fetchReviewRecordDiff(projectId, read.reviewId, scope)
              : fetchReviewDiff(projectId, read.storyId, scope)
        : skipToken,
    // The page starts this read before the diff panel mounts. A later subscriber
    // reuses the result; a moved tip invalidates the query.
    refetchOnMount: false,
    retry: retryReviewRead,
  });
}

const RUNTIME_BOOT_POLL_MS = 400;
const RUNTIME_POLL_MS = 2_000;

export function useReviewAgentRunsQuery(
  projectId: string,
  reviewId: string,
): UseQueryResult<{ runs: ReviewAgentRun[] }, Error> {
  return useQuery({
    queryKey: reviewKeys.agentRuns(projectId, reviewId),
    queryFn: () => fetchReviewAgentRuns(projectId, reviewId),
    enabled: Boolean(projectId) && Boolean(reviewId),
    retry: retryReviewRead,
    refetchInterval: (query) => reviewAgentRunsRefetchInterval(query.state.data?.runs),
  });
}

export function useReviewRuntimeQuery(
  reviewId: string,
): UseQueryResult<ReviewRuntimeStatus, Error> {
  return useQuery({
    queryKey: reviewKeys.runtime(reviewId),
    queryFn: () => fetchReviewRuntime(reviewId),
    enabled: Boolean(reviewId),
    retry: retryReviewRead,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "booting") return RUNTIME_BOOT_POLL_MS;
      if (state === "running") return RUNTIME_POLL_MS;
      return false;
    },
  });
}

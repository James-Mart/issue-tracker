import { request } from "@/lib/api/client";
import type {
  ReviewCommits,
  ReviewDiff,
  ReviewView,
  SetReviewMarkBody,
} from "@server/schemas";

export function reviewsUrl(projectId: string, storyId?: string): string {
  const path = `/api/projects/${encodeURIComponent(projectId)}/reviews`;
  if (storyId === undefined) return path;
  return `${path}?${new URLSearchParams({ storyId })}`;
}

export function reviewUrl(projectId: string, reviewId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewId)}`;
}

export function fetchReviews(
  projectId: string,
  storyId?: string,
): Promise<{ reviews: ReviewView[] }> {
  return request<{ reviews: ReviewView[] }>(reviewsUrl(projectId, storyId));
}

export function fetchReview(
  projectId: string,
  reviewId: string,
): Promise<ReviewView> {
  return request<ReviewView>(reviewUrl(projectId, reviewId));
}

export function reviewCommitsUrl(projectId: string, reviewId: string): string {
  return `${reviewUrl(projectId, reviewId)}/commits`;
}

export function reviewDiffUrl(
  projectId: string,
  reviewId: string,
  scope: string,
): string {
  const params = new URLSearchParams({ scope });
  return `${reviewUrl(projectId, reviewId)}/diff?${params}`;
}

export function fetchReviewCommits(
  projectId: string,
  reviewId: string,
): Promise<ReviewCommits> {
  return request<ReviewCommits>(reviewCommitsUrl(projectId, reviewId));
}

export function fetchReviewDiff(
  projectId: string,
  reviewId: string,
  scope: string,
): Promise<ReviewDiff> {
  return request<ReviewDiff>(reviewDiffUrl(projectId, reviewId, scope));
}

export function postOpenReview(
  projectId: string,
  storyId: string,
): Promise<ReviewView> {
  return request<ReviewView>(reviewsUrl(projectId), {
    method: "POST",
    body: { target: { kind: "story", storyId } },
  });
}

export function postArchiveReview(
  projectId: string,
  reviewId: string,
): Promise<ReviewView> {
  return request<ReviewView>(`${reviewUrl(projectId, reviewId)}/archive`, {
    method: "POST",
  });
}

export function postReopenReview(
  projectId: string,
  reviewId: string,
): Promise<ReviewView> {
  return request<ReviewView>(`${reviewUrl(projectId, reviewId)}/reopen`, {
    method: "POST",
  });
}

export function putReviewMark(
  projectId: string,
  reviewId: string,
  body: SetReviewMarkBody,
): Promise<ReviewView> {
  return request<ReviewView>(`${reviewUrl(projectId, reviewId)}/marks`, {
    method: "PUT",
    body,
  });
}

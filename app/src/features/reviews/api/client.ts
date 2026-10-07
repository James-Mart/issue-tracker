import { request } from "@/lib/api/client";
import type {
  ReviewCandidates,
  ReviewCommits,
  ReviewDiff,
  ReviewProgress,
  ReviewRecordView,
  ReviewView,
  SetReviewMarkBody,
} from "@server/schemas";

/** Empty-search size for the new-review picker. */
const NEW_REVIEW_PICKER_LIMIT = 5;

export function reviewsUrl(projectId: string, storyId?: string): string {
  const path = `/api/projects/${encodeURIComponent(projectId)}/reviews`;
  if (storyId === undefined) return path;
  return `${path}?${new URLSearchParams({ storyId })}`;
}

export function reviewUrl(projectId: string, reviewId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewId)}`;
}

export function reviewCandidatesUrl(projectId: string, query: string): string {
  const params = new URLSearchParams();
  if (query === "") params.set("limit", String(NEW_REVIEW_PICKER_LIMIT));
  else params.set("query", query);
  return `/api/projects/${encodeURIComponent(projectId)}/review-candidates?${params}`;
}

export function fetchReviewCandidates(
  projectId: string,
  query: string,
): Promise<ReviewCandidates> {
  return request<ReviewCandidates>(reviewCandidatesUrl(projectId, query));
}

export function fetchReviews(
  projectId: string,
  storyId?: string,
): Promise<{ reviews: ReviewRecordView[] }> {
  return request<{ reviews: ReviewRecordView[] }>(reviewsUrl(projectId, storyId));
}

export function reviewProgressUrl(projectId: string, reviewId: string): string {
  return `${reviewUrl(projectId, reviewId)}/progress`;
}

export function fetchReviewProgress(
  projectId: string,
  reviewId: string,
): Promise<ReviewProgress> {
  return request<ReviewProgress>(reviewProgressUrl(projectId, reviewId));
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

export function postSubmitReview(
  projectId: string,
  reviewId: string,
  summary?: string,
): Promise<ReviewView> {
  return request<ReviewView>(`${reviewUrl(projectId, reviewId)}/submissions`, {
    method: "POST",
    body: summary === undefined ? {} : { summary },
  });
}

export function postRetryOpenReviewSubmissions(
  projectId: string,
  reviewId: string,
): Promise<ReviewView> {
  return request<ReviewView>(`${reviewUrl(projectId, reviewId)}/submissions/retry`, {
    method: "POST",
    body: {},
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

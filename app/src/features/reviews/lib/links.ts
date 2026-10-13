import type { ReviewWorkbenchTab } from "./workbench-tabs";

export function projectReviewPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/review`;
}

export function reviewIssuePath(
  projectId: string,
  reviewId: string,
  tab?: ReviewWorkbenchTab,
): string {
  const path = `/projects/${encodeURIComponent(projectId)}/review/issues/${encodeURIComponent(reviewId)}`;
  return tab === undefined ? path : `${path}?tab=${tab}`;
}

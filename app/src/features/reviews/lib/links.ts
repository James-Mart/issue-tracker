import type { ReviewWorkbenchTab } from "./workbench-tabs";

export function projectReviewPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/review`;
}

export function storyReviewPath(
  projectId: string,
  storyId: string,
  tab?: ReviewWorkbenchTab,
): string {
  const path = `/projects/${encodeURIComponent(projectId)}/review/stories/${encodeURIComponent(storyId)}`;
  return tab === undefined ? path : `${path}?tab=${tab}`;
}

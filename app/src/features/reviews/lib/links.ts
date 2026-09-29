import type { ReviewWorkbenchTab } from "./workbench-tabs";

export function storyReviewPath(
  projectId: string,
  storyId: string,
  tab?: ReviewWorkbenchTab,
): string {
  const path = `/projects/${encodeURIComponent(projectId)}/review/stories/${encodeURIComponent(storyId)}`;
  return tab === undefined ? path : `${path}?tab=${tab}`;
}

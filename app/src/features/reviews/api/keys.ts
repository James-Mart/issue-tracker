export const reviewKeys = {
  all: ["reviews"] as const,
  lists: (projectId: string) => [...reviewKeys.all, "list", projectId] as const,
  list: (projectId: string, storyId?: string) =>
    storyId === undefined
      ? reviewKeys.lists(projectId)
      : ([...reviewKeys.lists(projectId), storyId] as const),
  details: () => [...reviewKeys.all, "detail"] as const,
  detail: (projectId: string, reviewId: string) =>
    [...reviewKeys.details(), projectId, reviewId] as const,
  candidates: (projectId: string, query: string) =>
    [...reviewKeys.all, "candidates", projectId, query] as const,
  commits: (projectId: string, reviewId: string) =>
    [...reviewKeys.all, "commits", projectId, reviewId] as const,
  diffs: (projectId: string, reviewId: string) =>
    [...reviewKeys.all, "diff", projectId, reviewId] as const,
  diff: (projectId: string, reviewId: string, scope: string) =>
    [...reviewKeys.diffs(projectId, reviewId), scope] as const,
};

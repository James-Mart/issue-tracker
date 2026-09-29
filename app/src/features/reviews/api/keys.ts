export const reviewKeys = {
  all: ["reviews"] as const,
  list: (projectId: string, storyId?: string) =>
    storyId === undefined
      ? ([...reviewKeys.all, "list", projectId] as const)
      : ([...reviewKeys.all, "list", projectId, storyId] as const),
  detail: (projectId: string, reviewId: string) =>
    [...reviewKeys.all, "detail", projectId, reviewId] as const,
  commits: (projectId: string, reviewId: string) =>
    [...reviewKeys.all, "commits", projectId, reviewId] as const,
  diff: (projectId: string, reviewId: string, scope: string) =>
    [...reviewKeys.all, "diff", projectId, reviewId, scope] as const,
};

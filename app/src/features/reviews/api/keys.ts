export const reviewKeys = {
  all: ["reviews"] as const,
  list: (projectId: string, storyId?: string) =>
    storyId === undefined
      ? ([...reviewKeys.all, "list", projectId] as const)
      : ([...reviewKeys.all, "list", projectId, storyId] as const),
  detail: (projectId: string, reviewId: string) =>
    [...reviewKeys.all, "detail", projectId, reviewId] as const,
};

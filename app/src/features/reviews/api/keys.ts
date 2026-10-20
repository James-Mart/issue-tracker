function withHeadSha(key: readonly string[], headSha?: string): readonly string[] {
  return headSha === undefined ? key : [...key, headSha];
}

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
  progress: (projectId: string, reviewId: string) =>
    [...reviewKeys.all, "progress", projectId, reviewId] as const,
  candidates: (projectId: string, query: string) =>
    [...reviewKeys.all, "candidates", projectId, query] as const,
  commits: (projectId: string, storyId: string) =>
    [...reviewKeys.all, "commits", projectId, storyId] as const,
  diffs: (projectId: string, storyId: string) =>
    [...reviewKeys.all, "diff", projectId, storyId] as const,
  diff: (projectId: string, storyId: string, scope: string) =>
    [...reviewKeys.diffs(projectId, storyId), scope] as const,
  reviewCommits: (projectId: string, reviewId: string, headSha?: string) =>
    withHeadSha([...reviewKeys.all, "review-commits", projectId, reviewId], headSha),
  reviewDiffs: (projectId: string, reviewId: string) =>
    [...reviewKeys.all, "review-diff", projectId, reviewId] as const,
  reviewDiff: (projectId: string, reviewId: string, scope: string, headSha?: string) =>
    withHeadSha([...reviewKeys.reviewDiffs(projectId, reviewId), scope], headSha),
  runtime: (reviewId: string) => [...reviewKeys.all, "runtime", reviewId] as const,
  runtimeLog: (reviewId: string) => [...reviewKeys.all, "runtime-log", reviewId] as const,
  agentRuns: (projectId: string, reviewId: string) =>
    [...reviewKeys.all, "agent-runs", projectId, reviewId] as const,
};

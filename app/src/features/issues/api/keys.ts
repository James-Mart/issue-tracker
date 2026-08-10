export const issuesKeys = {
  all: ["issues"] as const,
  list: () => [...issuesKeys.all, "list"] as const,
  detail: (id: string) => [...issuesKeys.all, "detail", id] as const,
  comments: (id: string) => [...issuesKeys.all, "comments", id] as const,
  attachments: (id: string) =>
    [...issuesKeys.all, "attachments", id] as const,
};

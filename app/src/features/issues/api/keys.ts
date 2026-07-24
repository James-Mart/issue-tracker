export const issuesKeys = {
  all: ["issues"] as const,
  list: () => [...issuesKeys.all, "list"] as const,
  detail: (id: string) => [...issuesKeys.all, "detail", id] as const,
  chat: (id: string) => [...issuesKeys.all, "chat", id] as const,
  attachments: (id: string) =>
    [...issuesKeys.all, "attachments", id] as const,
};

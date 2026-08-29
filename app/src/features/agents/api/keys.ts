export const agentsKeys = {
  all: ["agents"] as const,
  conversationsPrefix: () => [...agentsKeys.all, "conversations"] as const,
  conversations: (showArchived: boolean) =>
    [...agentsKeys.conversationsPrefix(), { showArchived }] as const,
  transcript: (id: string) =>
    [...agentsKeys.conversationsPrefix(), id, "transcript"] as const,
  attachments: (id: string) =>
    [...agentsKeys.conversationsPrefix(), id, "attachments"] as const,
  models: () => [...agentsKeys.all, "models"] as const,
};

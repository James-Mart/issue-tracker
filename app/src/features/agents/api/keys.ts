export const agentsKeys = {
  all: ["agents"] as const,
  conversationsPrefix: () => [...agentsKeys.all, "conversations"] as const,
  conversations: (showArchived: boolean) =>
    [...agentsKeys.conversationsPrefix(), { showArchived }] as const,
  models: () => [...agentsKeys.all, "models"] as const,
};

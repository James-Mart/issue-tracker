export const agentsKeys = {
  all: ["agents"] as const,
  conversations: () => [...agentsKeys.all, "conversations"] as const,
  conversation: (id: string) =>
    [...agentsKeys.all, "conversation", id] as const,
  models: () => [...agentsKeys.all, "models"] as const,
};

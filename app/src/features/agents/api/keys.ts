export const agentsKeys = {
  all: ["agents"] as const,
  conversations: () => [...agentsKeys.all, "conversations"] as const,
  models: () => [...agentsKeys.all, "models"] as const,
};

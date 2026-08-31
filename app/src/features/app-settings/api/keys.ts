export const backupKeys = {
  all: ["backup"] as const,
  current: () => [...backupKeys.all, "current"] as const,
};

export type RunCondition = "completed" | "in-flight" | "failed";

export type RecentRun = {
  conversationId: string;
  coordinatorLabel: string;
  startedAt: string;
  condition: RunCondition;
  issueId?: string;
  recoveredErrors?: number;
};

export const PIPELINE_RUNS_LIMIT = 20;

export function formatRunStartedAt(
  startedAt: string,
  now: Date = new Date(),
): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${time}`;
  }
  return `${date.toLocaleDateString([], { weekday: "short" })}, ${time}`;
}

export function conditionBadgeLabel(condition: RunCondition): string {
  if (condition === "in-flight") return "live";
  if (condition === "completed") return "done";
  return "failed";
}

export function recoveredMarkerLabel(count: number): string {
  return `↻${count}`;
}

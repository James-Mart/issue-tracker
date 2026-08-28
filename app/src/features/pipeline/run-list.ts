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
export const PHONE_RUN_LIST_SLOTS = 3;

export type RunListSegment =
  | { kind: "run"; run: RecentRun }
  | { kind: "elision"; omitted: RecentRun[] };

/** Phone slots: pin selected + newest failed, then fill newest-first. */
export function chooseVisibleRunIds(
  runs: RecentRun[],
  selectedConversationId: string | undefined,
  slotCount: number,
): Set<string> {
  const chosen = new Set<string>();
  if (
    selectedConversationId &&
    runs.some((run) => run.conversationId === selectedConversationId)
  ) {
    chosen.add(selectedConversationId);
  }
  const recentFailed = runs.find((run) => run.condition === "failed");
  if (recentFailed) chosen.add(recentFailed.conversationId);

  for (const run of runs) {
    if (chosen.size >= slotCount) break;
    chosen.add(run.conversationId);
  }
  return chosen;
}

export function buildRunListSegments(
  runs: RecentRun[],
  visibleIds: Set<string>,
): RunListSegment[] {
  const segments: RunListSegment[] = [];
  let pending: RecentRun[] = [];

  const flushElision = () => {
    if (pending.length === 0) return;
    segments.push({ kind: "elision", omitted: pending });
    pending = [];
  };

  for (const run of runs) {
    if (visibleIds.has(run.conversationId)) {
      flushElision();
      segments.push({ kind: "run", run });
    } else {
      pending.push(run);
    }
  }
  flushElision();
  return segments;
}

/** Desktop (`slotCount` null) renders every fetched run; phone truncates. */
export function runListSegments(
  runs: RecentRun[],
  selectedConversationId: string | undefined,
  slotCount: number | null,
): RunListSegment[] {
  if (slotCount == null || runs.length <= slotCount) {
    return runs.map((run) => ({ kind: "run" as const, run }));
  }
  return buildRunListSegments(
    runs,
    chooseVisibleRunIds(runs, selectedConversationId, slotCount),
  );
}

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

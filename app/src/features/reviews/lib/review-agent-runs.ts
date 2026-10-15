import type { ReviewAgentRun } from "@server/schemas";

const ROLE_LABELS: Record<string, string> = {
  "issue-tracker-review-tasker": "Tasker",
  "issue-tracker-standards-assessor": "Standards assessor",
  "issue-tracker-review-question": "Question researcher",
};

/** Short label for a review role. Any other role shows the stored string. */
export function reviewAgentRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Round name under the card: submission time, not the run's start. */
export function reviewRoundLabel(round: number, submittedAt: string): string {
  const date = new Date(submittedAt);
  const day = Number.isNaN(date.getTime())
    ? submittedAt
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `Round ${round} · ${day}`;
}

export type ReviewAgentRunName = {
  text: string;
  /** Where the name goes. Absent when the name is not a link yet. */
  target: "thread" | "conversation" | "standards" | null;
};

const TASKER_ROLE = "issue-tracker-review-tasker";
const ASSESSOR_ROLE = "issue-tracker-standards-assessor";

/** The question or the round the card names. Null when the run has neither. */
export function reviewAgentRunName(run: ReviewAgentRun): ReviewAgentRunName | null {
  if (run.questionExcerpt && run.threadId) {
    return { text: `"${run.questionExcerpt}"`, target: "thread" };
  }
  if (run.round === undefined || !run.submittedAt) return null;
  const text = reviewRoundLabel(run.round, run.submittedAt);
  if (run.role === TASKER_ROLE) {
    return { text, target: run.submittedEntry ? "conversation" : null };
  }
  if (run.role === ASSESSOR_ROLE) {
    return { text, target: "standards" };
  }
  return { text, target: null };
}

/**
 * Wide screen: a run the reader has not touched starts expanded only while it
 * is running. Phone never expands, and does not record that as a collapse.
 * Once latched, finishing leaves the choice alone.
 */
export function reviewRunExpansion(
  latched: boolean | undefined,
  running: boolean,
  wide: boolean,
): { expanded: boolean; latched: boolean | undefined } {
  if (!wide) return { expanded: false, latched };
  if (latched === undefined) return { expanded: running, latched: running };
  return { expanded: latched, latched };
}

/**
 * Record the wide-screen default the first time a run is seen. A phone does
 * not record a collapse. Returns the same map when nothing is new.
 */
export function seedReviewRunLatch(
  latch: ReadonlyMap<string, boolean>,
  runs: readonly { conversationId: string; status: string }[],
  wide: boolean,
): ReadonlyMap<string, boolean> {
  if (!wide) return latch;
  let seeded: Map<string, boolean> | null = null;
  for (const run of runs) {
    if (latch.has(run.conversationId)) continue;
    const next = reviewRunExpansion(undefined, run.status === "running", true);
    if (next.latched === undefined) continue;
    seeded ??= new Map(latch);
    seeded.set(run.conversationId, next.latched);
  }
  return seeded ?? latch;
}

/**
 * Wide screen, before the latch effect: an opened run shows its transcript
 * until the reader collapses it. A stored `false` is that collapse. `undefined`
 * is the first paint, which still shows the transcript.
 */
export function wideOpenedRunShowsExpanded(
  stored: boolean | undefined,
  dismissed: boolean,
): boolean {
  return !dismissed && stored !== false;
}

/**
 * Record the wide-screen default, then keep a URL-opened run expanded.
 * Seeding a finished run writes `false`; that is the untouched default, not a
 * collapse, so the opened run is set to expanded unless the reader dismissed it.
 */
export function latchWideOpenedRun(
  latch: ReadonlyMap<string, boolean>,
  runs: readonly { conversationId: string; status: string }[],
  wide: boolean,
  openedRunId: string | null,
  dismissedRunId: string | null,
): ReadonlyMap<string, boolean> {
  const seeded = seedReviewRunLatch(latch, runs, wide);
  if (!wide || !openedRunId || dismissedRunId === openedRunId) return seeded;
  if (seeded.get(openedRunId) === true) return seeded;
  const copy = new Map(seeded);
  copy.set(openedRunId, true);
  return copy;
}

/** Flip the wide-screen choice. A phone has no disclosure, so the latch stays. */
export function toggleReviewRunExpansion(
  latched: boolean | undefined,
  running: boolean,
  wide: boolean,
): { expanded: boolean; latched: boolean | undefined } {
  const current = reviewRunExpansion(latched, running, wide);
  if (!wide) return current;
  const expanded = !current.expanded;
  return { expanded, latched: expanded };
}

const ACTIVE_POLL_MS = 3_000;
const IDLE_POLL_MS = 15_000;

/** Fast while a run can still change; slow so a new run still appears. */
export function reviewAgentRunsRefetchInterval(
  runs: readonly { status: string }[] | undefined,
): number {
  if (
    !runs ||
    runs.some((run) => run.status === "running" || run.status === "unknown")
  ) {
    return ACTIVE_POLL_MS;
  }
  return IDLE_POLL_MS;
}

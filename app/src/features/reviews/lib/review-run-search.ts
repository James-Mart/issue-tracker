import {
  resolveReviewWorkbenchTab,
  type ReviewWorkbenchTab,
} from "./workbench-tabs";

/** Search param for the review run whose transcript is open. */
export const REVIEW_RUN_PARAM = "run";

/** History state set when this page pushed the open transcript. */
export function reviewRunWasOpened(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "reviewRunOpened" in state &&
    (state as { reviewRunOpened?: unknown }).reviewRunOpened === true
  );
}

export function reviewRunIdFromSearch(params: URLSearchParams): string | null {
  const value = params.get(REVIEW_RUN_PARAM);
  if (value === null || value.length === 0) return null;
  return value;
}

/**
 * Tab to return to. A missing tab is a direct transcript load, so Back
 * lands on Agents. Any explicit tab stays the surface the reader came from.
 */
export function reviewRunReturnTab(rawTab: string | null): string {
  if (rawTab === null || rawTab.length === 0) return "agents";
  return rawTab;
}

function writeReviewRunReturnTab(params: URLSearchParams): void {
  params.set("tab", reviewRunReturnTab(params.get("tab")));
}

/** Record which run is open, keeping the tab the reader is already on. */
export function searchWithReviewRun(
  params: URLSearchParams,
  runId: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  writeReviewRunReturnTab(next);
  next.set(REVIEW_RUN_PARAM, runId);
  return next;
}

export type ReviewRunReturn =
  | { surface: "thread"; threadId: string }
  | { surface: "conversation"; submissionId: string }
  | { surface: "standards"; submissionId: string };

/** Return place stored beside `reviewRunOpened` when a reverse link opened the run. */
export function reviewRunReturnFromState(state: unknown): ReviewRunReturn | null {
  if (!reviewRunWasOpened(state)) return null;
  const value = (state as { reviewRunReturn?: unknown }).reviewRunReturn;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.surface === "thread" &&
    typeof record.threadId === "string" &&
    record.threadId.length > 0
  ) {
    return { surface: "thread", threadId: record.threadId };
  }
  if (
    (record.surface === "conversation" || record.surface === "standards") &&
    typeof record.submissionId === "string" &&
    record.submissionId.length > 0
  ) {
    return { surface: record.surface, submissionId: record.submissionId };
  }
  return null;
}

function writeReviewRunReturn(params: URLSearchParams, returnTo: ReviewRunReturn): void {
  if (returnTo.surface === "thread") params.set("thread", returnTo.threadId);
  else params.set("tab", returnTo.surface);
}

/** Open a run, optionally on another tab, keeping a reverse link's return place. */
export function searchOpeningReviewRun(
  params: URLSearchParams,
  runId: string,
  options?: { tab?: string; returnTo?: ReviewRunReturn },
): URLSearchParams {
  const next = searchWithReviewRun(params, runId);
  if (options?.tab) next.set("tab", options.tab);
  if (options?.returnTo) writeReviewRunReturn(next, options.returnTo);
  return next;
}

/**
 * Leave a reverse-linked transcript on the thread, Conversation round, or
 * Standards round. The tab already in the URL stays for a thread.
 */
export function searchClosingReviewRun(
  params: URLSearchParams,
  returnTo: ReviewRunReturn,
): URLSearchParams {
  const next = searchWithoutReviewRun(params);
  writeReviewRunReturn(next, returnTo);
  return next;
}

/**
 * Leave the transcript. The tab already in the URL is the return surface.
 * When that tab is missing, write Agents — the direct-load return.
 */
export function searchWithoutReviewRun(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(REVIEW_RUN_PARAM);
  writeReviewRunReturnTab(next);
  return next;
}

/**
 * A transcript opened with no tab was loaded directly. Resolve that to Agents
 * so Back lands on the Review Agents tab. Any other tab stays the return surface.
 */
export function resolveReviewWorkbenchTabForRun(
  rawTab: string | null,
  runId: string | null,
  tabs: readonly { key: ReviewWorkbenchTab }[],
): ReviewWorkbenchTab {
  const tab = runId !== null ? reviewRunReturnTab(rawTab) : rawTab;
  return resolveReviewWorkbenchTab(tab, tabs);
}

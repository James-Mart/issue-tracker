import type { ReviewDiffPane } from "./review-diff-pane";

/** Page and diff-scroller offsets for the phone Files and Code panes. */
export type ReviewDiffPaneScroll = {
  filesPage: number;
  codePage: number;
  codeDiff: number;
};

export type PaneScrollRestore =
  | { kind: "files"; page: number }
  | { kind: "code"; page: number; diff: number }
  /** A path tap opens Code on that file, so the stored Code offset is not applied. */
  | { kind: "code-target" };

export const REVIEW_DIFF_SCROLLER_CLASS = "review-diff-scroller";

export function blankReviewDiffPaneScroll(): ReviewDiffPaneScroll {
  return { filesPage: 0, codePage: 0, codeDiff: 0 };
}

/** Keep the other pane's offset. A Files capture does not overwrite Code's diff scroller. */
export function storePaneScroll(
  memory: ReviewDiffPaneScroll,
  pane: ReviewDiffPane,
  captured: { page: number; diff: number },
): ReviewDiffPaneScroll {
  if (pane === "files") return { ...memory, filesPage: captured.page };
  return { ...memory, codePage: captured.page, codeDiff: captured.diff };
}

export function restoreForPane(
  memory: ReviewDiffPaneScroll,
  pane: ReviewDiffPane,
  pathJump: boolean,
): PaneScrollRestore {
  if (pane === "files") return { kind: "files", page: memory.filesPage };
  if (pathJump) return { kind: "code-target" };
  return { kind: "code", page: memory.codePage, diff: memory.codeDiff };
}

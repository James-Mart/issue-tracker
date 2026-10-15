import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import {
  restoreForPane,
  REVIEW_DIFF_SCROLLER_CLASS,
  storePaneScroll,
  type PaneScrollRestore,
  type ReviewDiffPaneScroll,
} from "../lib/review-diff-pane-scroll";
import type { ReviewDiffPane } from "../lib/review-diff-pane";

function pageScroller(): HTMLElement {
  const el = document.scrollingElement;
  if (!(el instanceof HTMLElement)) {
    throw new Error("review diff pane scroll: the page has no scrolling element");
  }
  return el;
}

/** Absent when this scope has no file changes, so there is no diff scroller yet. */
function diffScroller(): HTMLElement | null {
  const el = document.querySelector(`.${REVIEW_DIFF_SCROLLER_CLASS}`);
  return el instanceof HTMLElement ? el : null;
}

function readPaneScrollCapture(memory: ReviewDiffPaneScroll): { page: number; diff: number } {
  const diff = diffScroller();
  // A pane just hidden reports scrollTop 0. Keep the offset saved while it was open.
  const diffVisible = diff !== null && diff.getClientRects().length > 0;
  return {
    page: pageScroller().scrollTop,
    diff: diffVisible ? diff.scrollTop : memory.codeDiff,
  };
}

function applyPaneScrollRestore(action: PaneScrollRestore): void {
  if (action.kind === "files") {
    pageScroller().scrollTop = action.page;
    return;
  }
  pageScroller().scrollTop = action.kind === "code-target" ? 0 : action.page;
  if (action.kind !== "code") return;
  const diff = diffScroller();
  if (diff) diff.scrollTop = action.diff;
}

function scrollDiffToTop(): void {
  const diff = diffScroller();
  if (diff) diff.scrollTop = 0;
}

/**
 * On a phone, Files remembers the page offset and Code remembers the page
 * plus the diff scroller. A scope change zeros both. Wider windows scroll
 * inside the side-by-side columns, so this hook leaves them alone.
 * `pathJump` is set when a path tap opens Code on that file.
 */
export function useReviewDiffPaneScroll(
  pane: ReviewDiffPane,
  scope: string,
  wide: boolean | undefined,
  memory: MutableRefObject<ReviewDiffPaneScroll>,
  pathJump: MutableRefObject<boolean>,
): void {
  const paneRef = useRef<ReviewDiffPane | null>(null);
  const scopeRef = useRef(scope);
  const switching = useRef(false);
  const phone = wide === false;

  useEffect(() => {
    if (!phone) return;
    const onScroll = () => {
      if (switching.current) return;
      const current = paneRef.current;
      if (current === null) return;
      memory.current = storePaneScroll(memory.current, current, readPaneScrollCapture(memory.current));
    };
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [memory, phone]);

  useLayoutEffect(() => {
    if (!phone) return;
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    // The workbench already blanked the saved offsets during render, including
    // when this hook was unmounted. Here the visible scrollers still need to
    // move to the top.
    switching.current = true;
    pageScroller().scrollTop = 0;
    scrollDiffToTop();
    switching.current = false;
  }, [phone, scope]);

  useLayoutEffect(() => {
    // Width is unknown on the first paint. Recording the pane then would skip
    // the restore once the phone measurement arrives.
    if (!phone) {
      paneRef.current = null;
      return;
    }
    const previous = paneRef.current;
    if (previous === pane) return;
    switching.current = true;
    paneRef.current = pane;
    const jump = previous !== null && pathJump.current;
    pathJump.current = false;
    const action = restoreForPane(memory.current, pane, jump);
    applyPaneScrollRestore(action);
    // The diff scroller mounts at 0 and can overwrite a restore in the same
    // commit. Hold the saved offset across those frames; a path jump must not.
    if (action.kind !== "code" || action.diff === 0) {
      switching.current = false;
      return;
    }
    const saved = action.diff;
    let frames = 0;
    let id = 0;
    const stick = () => {
      const diff = diffScroller();
      if (diff && Math.abs(diff.scrollTop - saved) > 1) diff.scrollTop = saved;
      frames += 1;
      if (frames >= 8) {
        switching.current = false;
        return;
      }
      id = requestAnimationFrame(stick);
    };
    id = requestAnimationFrame(stick);
    return () => {
      cancelAnimationFrame(id);
      switching.current = false;
    };
  }, [memory, pane, pathJump, phone]);
}

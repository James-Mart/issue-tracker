import { useEffect, useRef, type MutableRefObject } from "react";
import { useVirtualizer } from "@pierre/diffs/react";
import {
  bandRevealDelta,
  diffScrollRoot,
  diffViewBelowHeader,
  seekPaintedDiffLine,
  type DiffLineSeek,
} from "../lib/review-diff-line-scroll";
import {
  clearReviewSearchMarks,
  markReviewContentHits,
  revealMarkInCodeColumn,
} from "../lib/review-diff-search-mark";
import type { DiffSearchMatch } from "../lib/review-diff-search";

/**
 * Marks every hit painted in this file's diff, the current one brighter, and
 * lands the current hit below the file's pinned header once per step. Only the
 * diff scroller and the hit's code column move, never the page. Hits live in
 * the diff shadow root, which paints after commit and repaints as the window
 * moves, so marks follow the paint. A refresh that re-marks the same hit leaves
 * the reader where they are. Must render inside a `Virtualizer`.
 */
export function useReviewSearchMarks(
  sectionRef: MutableRefObject<HTMLElement | null>,
  match: DiffSearchMatch | undefined,
  needle: string,
  collapsed: boolean,
) {
  const virtualizer = useVirtualizer();
  if (virtualizer == null) {
    throw new Error("useReviewSearchMarks must render inside a Virtualizer");
  }
  const landedStep = useRef<string>();

  useEffect(() => {
    const content = match?.kind === "content" ? match : undefined;
    const step = content ? `${needle}\n${content.index}` : undefined;
    if (step === undefined) landedStep.current = undefined;
    const section = sectionRef.current;
    if (!section || needle === "" || collapsed) return;

    let frame = 0;
    let attempts = 0;
    const seek: DiffLineSeek = { spanKey: "", stuck: 0 };
    const observed = new Set<Node>();
    const observer = new MutationObserver(() => {
      apply();
      watchShadows();
    });

    const watchShadows = () => {
      for (const host of section.querySelectorAll("diffs-container")) {
        if (host.shadowRoot && !observed.has(host.shadowRoot)) {
          observed.add(host.shadowRoot);
          observer.observe(host.shadowRoot, { childList: true, subtree: true });
        }
      }
    };

    const landing = () => content !== undefined && landedStep.current !== step;

    const land = (mark: HTMLElement) => {
      landedStep.current = step;
      cancelAnimationFrame(frame);
      const root = diffScrollRoot(virtualizer);
      const hit = mark.getBoundingClientRect();
      const delta = bandRevealDelta(diffViewBelowHeader(root, section), hit.top, hit.bottom);
      if (delta !== 0) virtualizer.scrollTo({ top: root.scrollTop + delta });
      revealMarkInCodeColumn(mark);
    };

    const apply = () => {
      const mark = markReviewContentHits(section, needle, content);
      if (mark && landing()) land(mark);
    };

    // Repaints only re-mark; moving the window toward an unpainted hit is one
    // seek per frame, since a scroll inside Pierre's overscan repaints nothing.
    const seekCurrent = () => {
      apply();
      if (content === undefined || !landing() || attempts >= 60) return;
      attempts += 1;
      const shadow = section.querySelector("diffs-container")?.shadowRoot;
      if (shadow) {
        const deletion = content.lineType === "change-deletion";
        seekPaintedDiffLine(
          virtualizer,
          section,
          shadow,
          deletion ? "old" : "new",
          deletion ? content.deletionLineNumber : content.additionLineNumber,
          seek,
        );
      }
      frame = requestAnimationFrame(seekCurrent);
    };

    observer.observe(section, { childList: true, subtree: true });
    watchShadows();
    seekCurrent();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clearReviewSearchMarks(section);
    };
  }, [collapsed, match, needle, sectionRef, virtualizer]);
}

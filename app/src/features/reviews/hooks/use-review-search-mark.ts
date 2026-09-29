import { useEffect, type MutableRefObject } from "react";
import {
  clearReviewSearchMarks,
  markReviewContentMatch,
  REVIEW_SEARCH_CURRENT_ATTR,
  scrollDiffTowardLine,
} from "../lib/review-diff-search-mark";
import type { DiffSearchMatch } from "../lib/review-diff-search";

function scrollMarkIntoView(mark: Element) {
  mark.scrollIntoView({ block: "center", inline: "nearest" });
}

/**
 * Marks the current hit after the file has scrolled into the virtualizer.
 * Content hits live in the diff shadow root, which renders after commit.
 */
export function useReviewSearchMark(
  sectionRef: MutableRefObject<HTMLElement | null>,
  match: DiffSearchMatch | undefined,
  needle: string,
  collapsed: boolean,
) {
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !match || needle === "") return;

    if (match.kind === "path") {
      const mark = section.querySelector(`[${REVIEW_SEARCH_CURRENT_ATTR}]`);
      if (mark) scrollMarkIntoView(mark);
      return;
    }
    if (collapsed) return;

    let stopped = false;
    let scrolls = 0;
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

    const apply = () => {
      if (stopped) return;
      if (findShadowMark(section)) return;
      const mark = markReviewContentMatch(section, match, needle);
      if (mark) {
        scrollMarkIntoView(mark);
        return;
      }
      if (scrolls >= 8) return;
      const lineNumber =
        match.lineType === "change-deletion"
          ? match.deletionLineNumber
          : match.additionLineNumber;
      if (scrollDiffTowardLine(section, lineNumber)) scrolls += 1;
    };

    observer.observe(section, { childList: true, subtree: true });
    watchShadows();
    apply();

    return () => {
      stopped = true;
      observer.disconnect();
      clearReviewSearchMarks(section);
    };
  }, [collapsed, match, needle, sectionRef]);
}

function findShadowMark(section: ParentNode): HTMLElement | null {
  for (const host of section.querySelectorAll("diffs-container")) {
    const mark = host.shadowRoot?.querySelector<HTMLElement>(`[${REVIEW_SEARCH_CURRENT_ATTR}]`);
    if (mark) return mark;
  }
  return null;
}

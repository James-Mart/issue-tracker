import { useEffect, type MutableRefObject } from "react";
import { useVirtualizer } from "@pierre/diffs/react";
import { threadNodeInPanel } from "@/features/issues/lib/issue-change-focus-thread";
import {
  diffScrollRoot,
  diffViewBelowHeader,
  paintedDiffLine,
  seekPaintedDiffLine,
  type DiffLineSeek,
} from "../lib/review-diff-line-scroll";
import type { DiffThreadReveal } from "./use-review-workbench-location";

/**
 * Scrolls a file section to a thread once per reveal request, then reports the
 * request done. Thread data refreshing does not re-run it: only a new request,
 * or the file expanding, does. Must render inside a `Virtualizer`.
 */
export function useDiffThreadReveal({
  sectionRef,
  reveal,
  line: lineAnchor,
  collapsed,
  onRevealed,
}: {
  sectionRef: MutableRefObject<HTMLElement | null>;
  reveal: DiffThreadReveal | undefined;
  /** The thread's diff line. Absent for file and Outdated threads, which scroll to their card. */
  line: { line: number; side: "old" | "new" } | undefined;
  collapsed: boolean;
  /** Must be stable; a new function restarts the reveal. */
  onRevealed: ((reveal: DiffThreadReveal) => void) | undefined;
}) {
  const virtualizer = useVirtualizer();
  if (virtualizer == null) {
    throw new Error("useDiffThreadReveal must render inside a Virtualizer");
  }
  const threadId = reveal?.threadId;
  const request = reveal?.request;
  const line = lineAnchor?.line;
  const side = lineAnchor?.side;
  useEffect(() => {
    if (threadId == null || request == null || collapsed) return;
    const panel = sectionRef.current;
    if (!panel) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    const seek: DiffLineSeek = { spanKey: "", stuck: 0 };

    const landed = (node?: HTMLElement | null) => {
      node?.scrollIntoView({ block: "nearest", inline: "nearest" });
      onRevealed?.({ threadId, request });
    };

    const step = () => {
      if (cancelled) return;
      attempts += 1;
      const node = threadNodeInPanel(panel, threadId);
      const host = panel.querySelector("diffs-container");
      const shadow = host instanceof HTMLElement ? host.shadowRoot : null;
      const row =
        line != null && side != null && shadow != null
          ? paintedDiffLine(shadow, side, line)
          : null;
      if (row != null) {
        const root = diffScrollRoot(virtualizer);
        const delta =
          row.getBoundingClientRect().top - diffViewBelowHeader(root, panel).start - 8;
        if (Math.abs(delta) > 2) {
          virtualizer.scrollTo({ top: virtualizer.getScrollTop() + delta });
        }
        landed();
        return;
      }

      if (line != null && side != null && shadow != null && attempts < 60) {
        seekPaintedDiffLine(virtualizer, panel, shadow, side, line, seek);
        frame = requestAnimationFrame(step);
        return;
      }

      if (node != null && node.getBoundingClientRect().height > 0) {
        landed(node);
        return;
      }
      if (attempts < 60 && (node == null || shadow != null)) {
        frame = requestAnimationFrame(step);
        return;
      }
      landed(node);
    };

    frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [collapsed, line, onRevealed, request, sectionRef, side, threadId, virtualizer]);
}

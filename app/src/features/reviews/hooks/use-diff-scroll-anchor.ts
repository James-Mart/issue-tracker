import { useEffect } from "react";
import { useVirtualizer } from "@pierre/diffs/react";
import {
  diffScrollAnchorDrift,
  pickDiffScrollAnchor,
  type DiffScrollAnchor,
} from "../lib/review-diff-scroll-anchor";

/**
 * Keeps what the reader is looking at in place when the diff above it changes
 * height: a reply arriving, a researcher status, a composer opening or
 * closing, annotations re-slotting. Pierre's own scroll fix covers only its
 * windowing passes, native scroll anchoring does not see through the diff's
 * shadow rows, and iOS Safari has none. Any scroll — the reader's or an
 * explicit navigation — takes a new anchor instead of being undone. Must
 * render inside a `Virtualizer`.
 */
export function useDiffScrollAnchor() {
  const virtualizer = useVirtualizer();
  if (virtualizer == null) {
    throw new Error("useDiffScrollAnchor must render inside a Virtualizer");
  }

  useEffect(() => {
    const root = virtualizer.getRoot();
    if (!(root instanceof HTMLElement) || root.firstElementChild == null) {
      throw new Error("useDiffScrollAnchor needs the Virtualizer's scroll element");
    }
    let anchor: DiffScrollAnchor | undefined = pickDiffScrollAnchor(root);
    const retake = () => {
      anchor = pickDiffScrollAnchor(root);
    };
    const hold = () => {
      // A scroll since the anchor was taken has not dispatched its event yet;
      // that scroll moved the view on purpose, so it is not drift to undo.
      if (anchor != null && root.scrollTop === anchor.scrollTop) {
        const drift = diffScrollAnchorDrift(root, anchor);
        if (Math.abs(drift) >= 1) {
          virtualizer.markDOMDirty();
          virtualizer.scrollTo({ top: virtualizer.getScrollTop() + drift });
        }
      }
      retake();
    };
    root.addEventListener("scroll", retake, { passive: true });
    const observer = new ResizeObserver(hold);
    observer.observe(root.firstElementChild);
    return () => {
      root.removeEventListener("scroll", retake);
      observer.disconnect();
    };
  }, [virtualizer]);
}

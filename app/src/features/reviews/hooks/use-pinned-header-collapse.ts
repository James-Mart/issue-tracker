import { useLayoutEffect, useRef, type MutableRefObject } from "react";
import { useVirtualizer } from "@pierre/diffs/react";

/**
 * Keeps the reader at a file collapsed from its pinned header. Collapsing a file
 * whose top has scrolled past the virtualizer's top would otherwise leave the
 * reader inside whichever file follows. Call the returned function from a header
 * action just before it collapses the file (a no-op while already collapsed);
 * when `collapsed` turns true, the file's header scrolls back to the top of the
 * scroll area. Pinned-ness is read at the action, not after the fact, because
 * other collapses (search releasing a file) must not move the reader. Must
 * render inside a `Virtualizer`.
 */
export function usePinnedHeaderCollapse(
  sectionRef: MutableRefObject<HTMLElement | null>,
  collapsed: boolean,
): () => void {
  const virtualizer = useVirtualizer();
  if (virtualizer == null) {
    throw new Error("usePinnedHeaderCollapse must render inside a Virtualizer");
  }
  const pinnedAtCollapse = useRef(false);

  useLayoutEffect(() => {
    if (!collapsed || !pinnedAtCollapse.current) return;
    pinnedAtCollapse.current = false;
    // The collapse just shrank the content; drop the virtualizer's cached scroll metrics before measuring.
    virtualizer.markDOMDirty();
    virtualizer.scrollTo({ top: virtualizer.getOffsetInScrollContainer(sectionRef.current!) });
  }, [collapsed, sectionRef, virtualizer]);

  return () => {
    if (collapsed) return;
    const fileTop = virtualizer.getOffsetInScrollContainer(sectionRef.current!);
    const headerPinned = fileTop < virtualizer.getScrollTop();
    pinnedAtCollapse.current = headerPinned;
  };
}

import { useCallback, useLayoutEffect, useRef } from "react";
import { useVirtualizer } from "@pierre/diffs/react";

/** `done` stops retrying. `wait` means the target is hidden or not laid out yet. */
type ScrollAttempt = "done" | "wait";

/**
 * Scrolls the enclosing Pierre `Virtualizer` to the file named `target`. Changing
 * `nonce` scrolls again when the same file is requested twice. Must render inside
 * a `Virtualizer`; register each file's node with `fileRef(name)`.
 */
export function useVirtualizedFileScroll<T extends HTMLElement>(
  target: string | undefined,
  nonce?: number,
): (name: string) => (node: T | null) => void {
  const virtualizer = useVirtualizer();
  const fileNodes = useRef(new Map<string, T>());

  const scrollToTarget = useCallback((): ScrollAttempt => {
    if (target == null || virtualizer?.getRoot() == null) return "done";
    const node = fileNodes.current.get(target);
    const root = virtualizer.getRoot();
    if (node == null || !(root instanceof HTMLElement)) return "wait";
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      // A display:none ancestor has no layout, so a 0 offset is not the top.
      if (getComputedStyle(parent).display === "none") return "wait";
    }
    const rect = node.getBoundingClientRect();
    const top = virtualizer.getOffsetInScrollContainer(node);
    const below = rect.top - root.getBoundingClientRect().top;
    // Laid out, but getOffsetInScrollContainer still reads 0 while the node sits
    // below the scroller — the ancestor was hidden when it was measured. No
    // layout (jsdom) keeps height 0 and scrolls from the virtualizer's own offset.
    if (rect.height > 0 && top <= 1 && below > 1) return "wait";
    virtualizer.scrollTo({ top });
    if (rect.height === 0 || top <= 1 || root.scrollTop > 1) return "done";
    return "wait";
  }, [target, virtualizer]);

  useLayoutEffect(() => {
    if (scrollToTarget() === "done") return;
    let frames = 0;
    let id = 0;
    const retry = () => {
      if (scrollToTarget() === "done" || frames >= 20) return;
      frames += 1;
      id = requestAnimationFrame(retry);
    };
    id = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(id);
  }, [nonce, scrollToTarget]);

  return useCallback(
    (name: string) => (node: T | null) => {
      if (node) fileNodes.current.set(name, node);
      else fileNodes.current.delete(name);
    },
    [],
  );
}

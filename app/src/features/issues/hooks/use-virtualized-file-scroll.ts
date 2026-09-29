import { useCallback, useLayoutEffect, useRef } from "react";
import { useVirtualizer } from "@pierre/diffs/react";

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

  useLayoutEffect(() => {
    if (target == null || virtualizer?.getRoot() == null) return;
    const node = fileNodes.current.get(target);
    if (node == null) return;
    virtualizer.scrollTo({ top: virtualizer.getOffsetInScrollContainer(node) });
  }, [nonce, target, virtualizer]);

  return useCallback(
    (name: string) => (node: T | null) => {
      if (node) fileNodes.current.set(name, node);
      else fileNodes.current.delete(name);
    },
    [],
  );
}

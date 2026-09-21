import { useLayoutEffect, useState, type RefObject } from "react";

/** Collapsed draft-field height — matches `min-h-[44px]` on the textarea. */
export const COMPOSER_MIN_HEIGHT_PX = 44;

/** Content-derived growth stops at this fraction of the thread pane. */
export const COMPOSER_AUTO_GROW_PANE_RATIO = 0.4;

/** Thread pane root — ConversationThread sets this so Composer can observe it. */
export const THREAD_PANE_SELECTOR = "[data-thread-pane]";

export function autoGrowCeilingPx(paneHeight: number): number {
  return paneHeight * COMPOSER_AUTO_GROW_PANE_RATIO;
}

/**
 * Content-derived draft height: never below the collapsed minimum, never
 * above the auto-grow ceiling. A ceiling below the minimum (tiny pane)
 * still yields the minimum — the range is empty, not inverted.
 */
export function clampAutoGrowHeight(
  scrollHeight: number,
  paneHeight: number,
): number {
  const ceiling = Math.max(
    autoGrowCeilingPx(paneHeight),
    COMPOSER_MIN_HEIGHT_PX,
  );
  return Math.min(Math.max(scrollHeight, COMPOSER_MIN_HEIGHT_PX), ceiling);
}

export function applyComposerAutoGrow(
  el: HTMLTextAreaElement | null,
  paneHeight: number,
): void {
  if (!el || paneHeight <= 0) return;
  el.style.height = `${COMPOSER_MIN_HEIGHT_PX}px`;
  el.style.height = `${clampAutoGrowHeight(el.scrollHeight, paneHeight)}px`;
}

/**
 * Live height of the thread pane that contains `fromRef`. Observed rather
 * than assumed so the auto-grow ceiling (and later the drag clamp) recompute
 * when the window, a panel tab, or the phone keyboard changes the pane.
 */
export function useThreadPaneHeight(
  fromRef: RefObject<Element | null>,
): number {
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const pane = fromRef.current?.closest(THREAD_PANE_SELECTOR);
    if (!pane) return;
    const measure = () => setHeight(pane.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [fromRef]);

  return height;
}

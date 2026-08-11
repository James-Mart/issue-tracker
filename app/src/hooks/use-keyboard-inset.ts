import { useEffect, useState } from "react";

export type VisualViewportMetrics = {
  /** Layout viewport height — what an `svh`-sized shell is measured against. */
  layoutHeight: number;
  /** Visible band height; the soft keyboard shrinks this, not the layout. */
  viewportHeight: number;
  /** Visible band offset from the layout viewport top. */
  offsetTop: number;
  /** Pinch-zoom scale, which shrinks the same band without covering anything. */
  scale: number;
};

/** Viewport heights round to fractional pixels; browser chrome is not a keyboard. */
const MIN_KEYBOARD_INSET_PX = 32;

/**
 * Height the soft keyboard covers at the bottom of the layout viewport. Shells
 * sized with `svh` keep their full height while the keyboard is up, so this is
 * what they have to give back for their bottom row to stay reachable.
 */
export function keyboardInsetPx(metrics: VisualViewportMetrics): number {
  if (metrics.scale > 1) return 0;
  const inset = Math.round(
    metrics.layoutHeight - metrics.viewportHeight - metrics.offsetTop,
  );
  return inset >= MIN_KEYBOARD_INSET_PX ? inset : 0;
}

/** Live soft-keyboard inset in CSS px; 0 whenever no keyboard is up. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const read = () => {
      setInset(
        keyboardInsetPx({
          layoutHeight: window.innerHeight,
          viewportHeight: viewport.height,
          offsetTop: viewport.offsetTop,
          scale: viewport.scale,
        }),
      );
    };
    read();
    viewport.addEventListener("resize", read);
    // The browser can scroll the visible band within the layout viewport to
    // reveal the focused field; the inset moves with it.
    viewport.addEventListener("scroll", read);
    return () => {
      viewport.removeEventListener("resize", read);
      viewport.removeEventListener("scroll", read);
    };
  }, []);

  return inset;
}

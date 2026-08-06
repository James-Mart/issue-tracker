import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { cn } from "@/lib/utils/cn";

/** Distance from the bottom (px) within which the reader counts as pinned. */
export const SCROLL_PIN_THRESHOLD_PX = 48;

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** True when the scroll position sits within `thresholdPx` of the bottom. */
export function isScrollPinned(
  metrics: ScrollMetrics,
  thresholdPx = SCROLL_PIN_THRESHOLD_PX,
): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <=
    thresholdPx
  );
}

/** Autoscroll to the bottom only while the reader is pinned. */
export function applyAutoscroll(el: ScrollMetrics, pinned: boolean): void {
  if (pinned) {
    el.scrollTop = el.scrollHeight;
  }
}

export function MessageScroller({
  children,
  bottomKey,
  className,
}: {
  children: ReactNode;
  bottomKey: unknown;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    applyAutoscroll(el, pinnedRef.current);
  }, [bottomKey]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const next = isScrollPinned(event.currentTarget);
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setPinned(next);
  }

  return (
    <div
      ref={ref}
      data-pinned={pinned ? "true" : "false"}
      onScroll={handleScroll}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

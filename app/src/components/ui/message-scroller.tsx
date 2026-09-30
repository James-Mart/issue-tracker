import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type UIEvent,
} from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { popoverSurface } from "@/components/ui/overlay-surfaces";
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
    scrollToBottom(el);
  }
}

/** Scroll the container to the latest content. */
export function scrollToBottom(el: ScrollMetrics): void {
  el.scrollTop = el.scrollHeight;
}

/** True when the scroll position sits within `thresholdPx` of the top. */
export function isScrollAtTop(
  metrics: Pick<ScrollMetrics, "scrollTop">,
  thresholdPx = SCROLL_PIN_THRESHOLD_PX,
): boolean {
  return metrics.scrollTop <= thresholdPx;
}

/** Put the content back at the same distance from the bottom after rows land above it. */
export function restoreDistanceFromBottom(
  el: ScrollMetrics,
  distanceFromBottom: number,
): void {
  el.scrollTop = el.scrollHeight - distanceFromBottom;
}

export function MessageScroller({
  children,
  bottomKey,
  topKey,
  onReachTop,
  className,
  ...rest
}: {
  children: ReactNode;
  bottomKey: unknown;
  /** Changes when rows are added or swapped above the content. */
  topKey?: unknown;
  /** Called while the reader sits at the top, on scroll and after each render. */
  onReachTop?: () => void;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className" | "onScroll">) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const distanceFromBottomRef = useRef(0);
  const [pinned, setPinned] = useState(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    restoreDistanceFromBottom(el, distanceFromBottomRef.current);
  }, [topKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    applyAutoscroll(el, pinnedRef.current);
  }, [bottomKey]);

  function syncTopEdge(el: ScrollMetrics) {
    distanceFromBottomRef.current = el.scrollHeight - el.scrollTop;
    if (onReachTop && isScrollAtTop(el)) onReachTop();
  }

  // Every commit: live rows grow the content while the reader is up the
  // thread, the next top insert restores against this distance, and a page
  // too short to scroll still reaches the top.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    syncTopEdge(el);
  });

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    syncTopEdge(el);
    const next = isScrollPinned(el);
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setPinned(next);
  }

  function handleJumpToBottom() {
    const el = ref.current;
    if (!el) return;
    scrollToBottom(el);
    pinnedRef.current = true;
    setPinned(true);
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        data-pinned={pinned ? "true" : "false"}
        onScroll={handleScroll}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-2",
          className,
        )}
        {...rest}
      >
        {children}
      </div>
      {!pinned ? (
        <Button
          type="button"
          variant="default"
          size="icon"
          onClick={handleJumpToBottom}
          aria-label="Jump to latest"
          title="Jump to latest"
          data-testid="jump-to-bottom"
          className={cn(
            "absolute bottom-4 right-3 z-10 h-11 w-11 shadow-md sm:bottom-3",
            popoverSurface,
          )}
        >
          <ArrowDown className="h-5 w-5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

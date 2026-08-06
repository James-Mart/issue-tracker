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

export function MessageScroller({
  children,
  bottomKey,
  className,
  ...rest
}: {
  children: ReactNode;
  bottomKey: unknown;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className" | "onScroll">) {
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

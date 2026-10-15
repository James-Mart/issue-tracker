import {
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils/cn";
import { REVIEW_SHELL_MEDIA_QUERY } from "../hooks/use-wide-review-workbench";

const PAN_SLOP_PX = 8;

type PathMetrics = {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

/** Identity for the layout effect: a rename is a different path than either side alone. */
export function reviewPathKey(path: string, oldPath?: string): string {
  return oldPath === undefined ? path : `${oldPath}\n${path}`;
}

/**
 * Offset that keeps the filename in view. `undefined` leaves the current
 * offset: the reader has scrolled, or the filename is already where it should be.
 * At the shell breakpoint the offset is the start, where truncation begins.
 */
function filenameScrollLeft(
  el: PathMetrics,
  shell: boolean,
  followFilename: boolean,
): number | undefined {
  if (shell) return el.scrollLeft === 0 ? undefined : 0;
  if (!followFilename) return undefined;
  const end = Math.max(0, el.scrollWidth - el.clientWidth);
  return el.scrollLeft === end ? undefined : end;
}

/** True when the filename (the end of the path) is the part in view. */
function pathShowsFilename(el: PathMetrics): boolean {
  const end = Math.max(0, el.scrollWidth - el.clientWidth);
  return el.scrollLeft >= end - 1;
}

type PanGesture = {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  startScroll: number;
};

/**
 * Path text for the review diff. Below the `shell` breakpoint the filename
 * stays in view and a sideways scroll reveals the directories. At `shell`
 * the text truncates from the end.
 */
export function ReviewPathScroll({
  pathKey,
  children,
  className,
  title,
}: {
  pathKey: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const pinning = useRef(false);
  const shellRef = useRef(false);
  const panned = useRef(false);
  const gesture = useRef<PanGesture | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let followFilename = true;
    let disposed = false;
    const mq = window.matchMedia(REVIEW_SHELL_MEDIA_QUERY);

    const apply = () => {
      if (disposed) return;
      shellRef.current = mq.matches;
      const next = filenameScrollLeft(el, mq.matches, followFilename);
      if (next === undefined) return;
      pinning.current = true;
      el.scrollLeft = next;
      queueMicrotask(() => {
        pinning.current = false;
      });
    };

    const onScroll = () => {
      if (pinning.current || mq.matches) return;
      followFilename = pathShowsFilename(el);
    };

    const onMedia = () => {
      if (mq.matches) followFilename = true;
      apply();
    };

    el.addEventListener("scroll", onScroll);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    if (document.fonts?.ready) void document.fonts.ready.then(apply);
    mq.addEventListener("change", onMedia);
    return () => {
      disposed = true;
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
      mq.removeEventListener("change", onMedia);
    };
  }, [pathKey]);

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    panned.current = false;
    gesture.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startScroll: event.currentTarget.scrollLeft,
    };
    if (event.pointerType !== "touch") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const endGesture = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (
      current.pointerType !== "touch" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (Math.abs(dx) <= PAN_SLOP_PX || Math.abs(dx) < Math.abs(dy)) return;
    if (shellRef.current) return;
    if (current.pointerType !== "touch") {
      event.preventDefault();
      event.currentTarget.scrollLeft = current.startScroll - dx;
    }
    panned.current = true;
  };

  const onClick = (event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!panned.current) return;
    panned.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <span
      ref={ref}
      title={title}
      data-testid="review-path-scroll"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onClick={onClick}
      className={cn(
        "min-w-0 flex-1 overflow-x-auto overflow-y-hidden whitespace-nowrap text-left tabular-nums",
        "overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        "shell:truncate",
        className,
      )}
    >
      {children}
    </span>
  );
}

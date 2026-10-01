import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  MIN_REVIEW_FILE_LIST_WIDTH,
  REVIEW_FILE_LIST_WIDTH_STEP,
  clearStoredReviewFileListWidth,
  readStoredReviewFileListWidth,
  resolveReviewFileListWidth,
  reviewFileListWidthCeiling,
  writeStoredReviewFileListWidth,
} from "../lib/review-file-list-width";

export function useReviewFileListWidth(splitRef: RefObject<HTMLElement | null>): {
  width: number;
  maxWidth: number;
  resizeToPointer: (clientX: number) => number | undefined;
  resizeEnd: () => void;
  step: (direction: -1 | 1) => void;
  reset: () => void;
} {
  const [stored, setStored] = useState<number | null>(() =>
    readStoredReviewFileListWidth(),
  );
  const [splitWidth, setSplitWidth] = useState(0);
  const storedRef = useRef(stored);
  const dragLiveRef = useRef<number | null>(null);
  storedRef.current = stored;

  useLayoutEffect(() => {
    const split = splitRef.current;
    if (!split) return;
    const measure = () => setSplitWidth(split.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(split);
    return () => observer.disconnect();
  }, [splitRef]);

  const committed = resolveReviewFileListWidth(stored, splitWidth);
  const width = dragLiveRef.current ?? committed;
  const maxWidth =
    splitWidth > 0
      ? reviewFileListWidthCeiling(splitWidth)
      : Math.max(width, MIN_REVIEW_FILE_LIST_WIDTH);

  const commit = (next: number | null) => {
    const measured = splitRef.current?.clientWidth ?? splitWidth;
    const applied = resolveReviewFileListWidth(next, measured);
    storedRef.current = applied;
    setStored(applied);
    writeStoredReviewFileListWidth(applied);
  };

  const resizeToPointer = (clientX: number) => {
    const split = splitRef.current;
    if (!split) return;
    const rect = split.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const applied = resolveReviewFileListWidth(clientX - rect.left, rect.width);
    dragLiveRef.current = applied;
    split.style.setProperty("--review-file-list-width", `${applied}px`);
    return applied;
  };

  const resizeEnd = () => {
    const live = dragLiveRef.current;
    dragLiveRef.current = null;
    if (live == null) return;
    commit(live);
  };

  const step = (direction: -1 | 1) => {
    const measured = splitRef.current?.clientWidth ?? splitWidth;
    const base = resolveReviewFileListWidth(storedRef.current, measured);
    commit(base + direction * REVIEW_FILE_LIST_WIDTH_STEP);
  };

  const reset = () => {
    dragLiveRef.current = null;
    clearStoredReviewFileListWidth();
    storedRef.current = null;
    setStored(null);
  };

  return { width, maxWidth, resizeToPointer, resizeEnd, step, reset };
}

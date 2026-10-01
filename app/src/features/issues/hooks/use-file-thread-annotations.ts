import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  DiffLineAnnotation,
  FileDiffMetadata,
  SelectedLineRange,
} from "@pierre/diffs/react";
import { useDiffComposer } from "../components/comments/diff-thread-composer";
import type { CommentThread } from "../lib/comment-threads";
import {
  composerOpensInFile,
  isLineComposer,
  newComposerForRange,
} from "../lib/diff-thread-anchor";
import {
  keepAnnotationOrder,
  mergeComposerAnnotation,
  placeThreadsInFile,
} from "../lib/issue-change-inline-threads";

/** `keepAnnotationOrder` against the annotations the last committed render showed. */
function useKeepAnnotationOrder<T>(
  next: DiffLineAnnotation<T>[],
): DiffLineAnnotation<T>[] {
  const shownRef = useRef<DiffLineAnnotation<T>[]>([]);
  const ordered = useMemo(() => keepAnnotationOrder(shownRef.current, next), [next]);
  useEffect(() => {
    shownRef.current = ordered;
  }, [ordered]);
  return ordered;
}

/** Thread and new-thread composer annotations for one file diff, with its line-selection handlers. */
export function useFileThreadAnnotations(fileDiff: FileDiffMetadata, threads: CommentThread[]) {
  const { open, openNew } = useDiffComposer();
  const { located, unlocated } = useMemo(
    () => placeThreadsInFile(threads, fileDiff),
    [fileDiff, threads],
  );
  const lines = useMemo(() => {
    if (open?.kind !== "new" || !isLineComposer(open) || !composerOpensInFile(open, fileDiff)) {
      return located;
    }
    return mergeComposerAnnotation(located, open);
  }, [fileDiff, located, open]);
  const annotations = useKeepAnnotationOrder(lines);
  const openFromRange = useCallback(
    (range: SelectedLineRange) => openNew(newComposerForRange(range, fileDiff)),
    [fileDiff, openNew],
  );
  const onLineSelected = useCallback(
    (range: SelectedLineRange | null) => {
      if (range == null || range.start === range.end) return;
      openFromRange(range);
    },
    [openFromRange],
  );
  return { annotations, unlocated, openFromRange, onLineSelected };
}

import { useCallback, useMemo } from "react";
import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs/react";
import { useDiffComposer } from "../components/comments/diff-thread-composer";
import type { CommentThread } from "../lib/comment-threads";
import { composerOpensInFile, newComposerForRange } from "../lib/diff-thread-anchor";
import { mergeComposerAnnotation, placeThreadsInFile } from "../lib/issue-change-inline-threads";

/** Thread and new-thread composer annotations for one file diff, with its line-selection handlers. */
export function useFileThreadAnnotations(fileDiff: FileDiffMetadata, threads: CommentThread[]) {
  const { open, openNew } = useDiffComposer();
  const { located, unlocated } = useMemo(
    () => placeThreadsInFile(threads, fileDiff),
    [fileDiff, threads],
  );
  const annotations = useMemo(() => {
    if (open?.kind !== "new" || !composerOpensInFile(open, fileDiff)) return located;
    return mergeComposerAnnotation(located, open);
  }, [fileDiff, located, open]);
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

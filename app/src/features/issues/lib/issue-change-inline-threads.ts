import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs/react";
import { isLineAnchor } from "@server/schemas";
import {
  selectAnchoredThreads,
  type CommentThread,
} from "./comment-threads";
import { fileAnchorPaths } from "./diff-thread-anchor";

export type FileThreadPlacement = {
  located: DiffLineAnnotation<CommentThread[]>[];
  unlocated: CommentThread[];
};

function hunkHasLine(
  hunks: FileDiffMetadata["hunks"],
  side: "old" | "new",
  line: number,
): boolean {
  for (const hunk of hunks) {
    const start = side === "old" ? hunk.deletionStart : hunk.additionStart;
    const count = side === "old" ? hunk.deletionCount : hunk.additionCount;
    if (count > 0 && line >= start && line < start + count) return true;
  }
  return false;
}

function lineAnnotationKey(
  annotation: Pick<DiffLineAnnotation<unknown>, "side" | "lineNumber">,
): string {
  return `${annotation.side}:${annotation.lineNumber}`;
}

/** Place anchored threads on this file's hunk lines, or at the file end. */
export function placeThreadsInFile(
  threads: CommentThread[],
  file: Pick<FileDiffMetadata, "name" | "prevName" | "hunks">,
): FileThreadPlacement {
  const locatedByKey = new Map<string, DiffLineAnnotation<CommentThread[]>>();
  const unlocated: CommentThread[] = [];
  const seen = new Set<string>();

  for (const path of fileAnchorPaths(file)) {
    for (const side of ["old", "new"] as const) {
      const byLine = selectAnchoredThreads(threads, path, side);
      for (const [line, lineThreads] of byLine) {
        const fresh = lineThreads.filter((thread) => !seen.has(thread.root.id));
        if (fresh.length === 0) continue;
        for (const thread of fresh) seen.add(thread.root.id);

        if (!hunkHasLine(file.hunks, side, line)) {
          unlocated.push(...fresh);
          continue;
        }

        const annotationSide = side === "old" ? "deletions" : "additions";
        const key = lineAnnotationKey({ side: annotationSide, lineNumber: line });
        const existing = locatedByKey.get(key);
        if (existing) {
          existing.metadata.push(...fresh);
          continue;
        }
        locatedByKey.set(key, {
          side: annotationSide,
          lineNumber: line,
          metadata: fresh,
        });
      }
    }
  }

  for (const thread of threads) {
    const anchor = thread.root.anchor;
    if (!anchor || isLineAnchor(anchor) || seen.has(thread.root.id)) continue;
    if (!fileAnchorPaths(file).includes(anchor.path)) continue;
    seen.add(thread.root.id);
    unlocated.push(thread);
  }

  return { located: [...locatedByKey.values()], unlocated };
}

/** Add a composer-only annotation when that line does not already host threads. */
export function mergeComposerAnnotation(
  located: DiffLineAnnotation<CommentThread[]>[],
  composer: { side: "old" | "new"; line: number } | null,
): DiffLineAnnotation<CommentThread[]>[] {
  if (!composer) return located;
  const side = composer.side === "old" ? "deletions" : "additions";
  if (
    located.some(
      (annotation) =>
        annotation.side === side && annotation.lineNumber === composer.line,
    )
  ) {
    return located;
  }
  return [
    ...located,
    { side, lineNumber: composer.line, metadata: [] },
  ];
}

/**
 * Pierre keys annotation slots by array index, so a line whose index moves
 * remounts its threads and any composer open in them. Keep lines from the
 * previous render in their previous order and append new lines after them.
 * A removed line still shifts the lines after it.
 */
export function keepAnnotationOrder<T>(
  previous: readonly DiffLineAnnotation<T>[],
  next: DiffLineAnnotation<T>[],
): DiffLineAnnotation<T>[] {
  const pending = new Map(
    next.map((annotation) => [lineAnnotationKey(annotation), annotation]),
  );
  const ordered: DiffLineAnnotation<T>[] = [];
  for (const annotation of previous) {
    const key = lineAnnotationKey(annotation);
    const current = pending.get(key);
    if (!current) continue;
    ordered.push(current);
    pending.delete(key);
  }
  ordered.push(...pending.values());
  return ordered.every((annotation, index) => annotation === next[index])
    ? next
    : ordered;
}

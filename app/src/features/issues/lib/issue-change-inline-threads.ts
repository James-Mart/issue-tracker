import type { DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs/react";
import {
  selectAnchoredThreads,
  type CommentThread,
} from "./comment-threads";

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

function filePaths(file: Pick<FileDiffMetadata, "name" | "prevName">): string[] {
  if (file.prevName && file.prevName !== file.name) {
    return [file.name, file.prevName];
  }
  return [file.name];
}

/** Place anchored threads on this file's hunk lines, or at the file end. */
export function placeThreadsInFile(
  threads: CommentThread[],
  file: Pick<FileDiffMetadata, "name" | "prevName" | "hunks">,
): FileThreadPlacement {
  const locatedByKey = new Map<string, DiffLineAnnotation<CommentThread[]>>();
  const unlocated: CommentThread[] = [];
  const seen = new Set<string>();

  for (const path of filePaths(file)) {
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
        const key = `${annotationSide}:${line}`;
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

  return { located: [...locatedByKey.values()], unlocated };
}

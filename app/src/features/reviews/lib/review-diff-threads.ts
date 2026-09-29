import type { ReviewDiffFile } from "@server/schemas";
import { anchorLineRange } from "@/features/issues/lib/comment-anchor-snippet";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { fileNameForAnchorPath } from "@/features/issues/lib/issue-change-focus-thread";
import { ALL_CHANGES_SCOPE } from "./review-scope";

/** One file card's threads: at anchor lines, and in its Outdated group. */
export type ReviewFileThreads = {
  inline: CommentThread[];
  outdated: CommentThread[];
};

export const NO_FILE_THREADS: ReviewFileThreads = { inline: [], outdated: [] };

/**
 * Anchored threads the Diff tab shows in this scope, keyed by file path.
 * A commit shows only threads anchored to it; their lines are that commit's
 * lines, so they stay inline even when outdated. All changes shows every
 * anchored thread and moves outdated ones out of the code.
 */
export function reviewDiffThreadsByFile(
  threads: CommentThread[],
  files: Pick<ReviewDiffFile, "path" | "oldPath">[],
  scope: string,
): Map<string, ReviewFileThreads> {
  const names = files.map((file) => ({ name: file.path, prevName: file.oldPath }));
  const shown = threads.flatMap((thread) => {
    const anchor = thread.root.anchor;
    if (!anchor) return [];
    if (scope !== ALL_CHANGES_SCOPE && anchor.commitSha !== scope) return [];
    // A file no longer in this diff has no card; its threads stay on Conversation.
    const path = fileNameForAnchorPath(names, anchor.path);
    if (path === undefined) return [];
    return [{ thread, path, start: anchorLineRange(anchor).start }];
  });
  const moved = ({ thread }: { thread: CommentThread }) =>
    scope === ALL_CHANGES_SCOPE && thread.root.outdated === true;

  const byFile = new Map<string, ReviewFileThreads>();
  const bucketFor = (path: string) => {
    let bucket = byFile.get(path);
    if (!bucket) {
      bucket = { inline: [], outdated: [] };
      byFile.set(path, bucket);
    }
    return bucket;
  };
  for (const { thread, path } of shown.filter((entry) => !moved(entry))) {
    bucketFor(path).inline.push(thread);
  }
  for (const { thread, path } of shown.filter(moved).sort((a, b) => a.start - b.start)) {
    bucketFor(path).outdated.push(thread);
  }
  return byFile;
}

export function fileShowingThread(
  byFile: Map<string, ReviewFileThreads>,
  threadId: string,
): string | undefined {
  const isThread = (thread: CommentThread) => thread.root.id === threadId;
  for (const [path, { inline, outdated }] of byFile) {
    if (inline.some(isThread) || outdated.some(isThread)) return path;
  }
  return undefined;
}

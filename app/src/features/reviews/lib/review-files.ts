import type { ReviewDiffFile, ReviewView } from "@server/schemas";
import { shortSha } from "@/lib/utils/short-sha";
import { ALL_CHANGES_SCOPE } from "./review-scope";

export type ReviewFileRow = {
  file: ReviewDiffFile;
  reviewed: boolean;
  changedSinceReviewed: boolean;
};

/** "All changes" marks count only while their blob sha still matches the file's post-image. */
export function allChangesFileRows(
  review: ReviewView,
  files: ReviewDiffFile[],
): ReviewFileRow[] {
  const changed = new Set(review.progress.all.changedSinceReviewed);
  return files.map((file) => ({
    file,
    reviewed: review.marks.all[file.path]?.blobSha === file.blobSha,
    changedSinceReviewed: changed.has(file.path),
  }));
}

/**
 * Rows for the active scope. Commit marks never go stale: a commit's content
 * is fixed, so they carry no "changed since reviewed" signal.
 */
export function scopeFileRows(
  review: ReviewView,
  files: ReviewDiffFile[],
  scope: string,
): ReviewFileRow[] {
  if (scope === ALL_CHANGES_SCOPE) return allChangesFileRows(review, files);
  const bucket = review.marks.commits[scope] ?? {};
  return files.map((file) => ({
    file,
    reviewed: file.path in bucket,
    changedSinceReviewed: false,
  }));
}

/** Whole-review progress from the net diff, plus optimistic "All changes" marks. */
export function allChangesReviewedCount(
  review: ReviewView,
  files: ReviewDiffFile[],
  overrides: Record<string, boolean> | undefined,
): { reviewed: number; total: number } {
  let reviewed = 0;
  for (const row of allChangesFileRows(review, files)) {
    if (overrides?.[row.file.path] ?? row.reviewed) reviewed += 1;
  }
  return { reviewed, total: files.length };
}

export function fileCountLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

export function diffLineTotals(files: ReviewDiffFile[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { additions, deletions };
}

/** Command that shows one file's diff for this scope in a local checkout. */
export function localFileDiffCommand(
  mergeBaseRef: string,
  tip: string,
  path: string,
  scope: string,
): string {
  if (scope === ALL_CHANGES_SCOPE) {
    return `git diff ${mergeBaseRef}...${shortSha(tip)} -- ${path}`;
  }
  return `git show ${shortSha(scope)} -- ${path}`;
}

export function fileTooLargeHint(scope: string): string {
  if (scope === ALL_CHANGES_SCOPE) {
    return "Read it in the project workspace with git diff from the merge base through the Story tip.";
  }
  return "Read it in the project workspace with git show on this commit.";
}

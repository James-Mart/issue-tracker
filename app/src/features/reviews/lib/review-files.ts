import type { ReviewDiffFile, ReviewView } from "@server/schemas";
import { shortSha } from "@/lib/utils/short-sha";

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

/** Command that shows one file's "All changes" diff in a local checkout. */
export function localFileDiffCommand(
  mergeBaseRef: string,
  tip: string,
  path: string,
): string {
  return `git diff ${mergeBaseRef}...${shortSha(tip)} -- ${path}`;
}

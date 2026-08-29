import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";

/** Flatten a unified git patch into one `FileDiffMetadata` per changed file. */
export function fileDiffsFromPatch(patch: string): FileDiffMetadata[] {
  return parsePatchFiles(patch).flatMap((parsed) => parsed.files);
}

/** Per-file +/− counts from hunks already parsed out of the patch. */
export function fileLineCounts(file: FileDiffMetadata): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

/** Substring match on the file path; empty query keeps every file. */
export function filterFilesByPath(
  files: FileDiffMetadata[],
  query: string,
): FileDiffMetadata[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return files;
  return files.filter((file) => file.name.toLowerCase().includes(needle));
}

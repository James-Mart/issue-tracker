import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs/react";

/** Flatten a unified git patch into one `FileDiffMetadata` per changed file. */
export function fileDiffsFromPatch(patch: string): FileDiffMetadata[] {
  return parsePatchFiles(patch).flatMap((parsed) => parsed.files);
}

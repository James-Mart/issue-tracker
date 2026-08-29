import type {
  FileDiffLoadedFiles,
  FileDiffMetadata,
} from "@pierre/diffs/react";
import { fetchIssueChangeFile } from "../api/queries";

/** Same split as `@pierre/diffs` `splitFileContents` — keeps trailing newlines. */
const SPLIT_WITH_NEWLINES = /(?<=\n)/;

function splitFileContents(contents: string): string[] {
  return contents !== "" ? contents.split(SPLIT_WITH_NEWLINES) : [];
}

function requireLine(
  lines: string[],
  index: number,
  what: string,
  fileName: string,
): string {
  const line = lines[index];
  if (line === undefined) {
    throw new Error(`${what} missing while reconstructing ${fileName}`);
  }
  return line;
}

/**
 * Rebuild the pre-change file from the new file plus the patch hunks.
 * The file-at-sha endpoint only serves issue commit shas (the after state).
 */
export function reconstructOldFileContents(
  fileDiff: FileDiffMetadata,
  newContents: string,
): string {
  const newLines = splitFileContents(newContents);
  const oldLines: string[] = [];
  let newPos = 0;

  for (const hunk of fileDiff.hunks) {
    const hunkNewStart = Math.max(hunk.additionStart - 1, 0);
    while (newPos < hunkNewStart) {
      oldLines.push(requireLine(newLines, newPos, "new-file line", fileDiff.name));
      newPos++;
    }
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let i = 0; i < content.lines; i++) {
          oldLines.push(
            requireLine(newLines, newPos, "context line", fileDiff.name),
          );
          newPos++;
        }
        continue;
      }
      for (let i = 0; i < content.deletions; i++) {
        oldLines.push(
          requireLine(
            fileDiff.deletionLines,
            content.deletionLineIndex + i,
            "deletion line",
            fileDiff.name,
          ),
        );
      }
      newPos += content.additions;
    }
  }

  while (newPos < newLines.length) {
    oldLines.push(newLines[newPos]!);
    newPos++;
  }

  return oldLines.join("");
}

export function fileDiffLoadedFiles(
  fileDiff: FileDiffMetadata,
  newContents: string,
): FileDiffLoadedFiles {
  const newFile = { name: fileDiff.name, contents: newContents };
  if (fileDiff.type === "rename-pure") {
    return { oldFile: null, newFile };
  }
  return {
    oldFile: {
      name: fileDiff.prevName ?? fileDiff.name,
      contents: reconstructOldFileContents(fileDiff, newContents),
    },
    newFile,
  };
}

export function cachedFileContents(
  cache: Map<string, Promise<string>>,
  key: string,
  load: () => Promise<string>,
): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = load().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

export function changeFileCacheKey(sha: string, path: string): string {
  return `${sha}:${path}`;
}

export async function loadFileDiffContents(args: {
  issueId: string;
  sha: string;
  fileDiff: FileDiffMetadata;
  cache: Map<string, Promise<string>>;
}): Promise<FileDiffLoadedFiles> {
  const path = args.fileDiff.name;
  const contents = await cachedFileContents(
    args.cache,
    changeFileCacheKey(args.sha, path),
    () => fetchIssueChangeFile(args.issueId, args.sha, path),
  );
  return fileDiffLoadedFiles(args.fileDiff, contents);
}

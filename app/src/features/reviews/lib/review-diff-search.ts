import { cloneFileDiffMetadata, type FileDiffMetadata } from "@pierre/diffs";
import type { ReviewDiffFile } from "@server/schemas";

export type DiffSearchLineType = "context" | "change-addition" | "change-deletion";

type PathMatch = {
  index: number;
  path: string;
  kind: "path";
  field: "path" | "oldPath";
  occurrence: number;
};

type ContentMatch = {
  index: number;
  path: string;
  kind: "content";
  lineType: DiffSearchLineType;
  /** File line number Pierre renders on the addition / unified column. */
  additionLineNumber: number;
  /** File line number Pierre renders on the deletion column. */
  deletionLineNumber: number;
  occurrence: number;
};

export type DiffSearchMatch = PathMatch | ContentMatch;

export type SearchableDiff = Pick<FileDiffMetadata, "additionLines" | "deletionLines" | "hunks">;

/** Copy patch lines before a diff renderer hydrates the same metadata in place. */
export function snapshotSearchableDiff(file: FileDiffMetadata): SearchableDiff {
  const clone = cloneFileDiffMetadata(file);
  return {
    additionLines: clone.additionLines,
    deletionLines: clone.deletionLines,
    hunks: clone.hunks,
  };
}

/**
 * Non-overlapping, case-insensitive hits. Both match collection and the marks
 * scan through this, so a match's `occurrence` names the hit it marks.
 */
function forEachOccurrence(
  text: string,
  needle: string,
  onHit: (occurrence: number, start: number) => void,
) {
  if (needle.length === 0) return;
  const hay = text.toLowerCase();
  const n = needle.toLowerCase();
  let from = 0;
  let occurrence = 0;
  while (from <= hay.length - n.length) {
    const at = hay.indexOf(n, from);
    if (at < 0) return;
    onHit(occurrence, at);
    occurrence += 1;
    from = at + n.length;
  }
}

export type SearchHit = { start: number; end: number; current: boolean };

/** Every hit in occurrence order; the `current`th one, if any, is current. */
export function searchHits(text: string, needle: string, current: number | undefined): SearchHit[] {
  const hits: SearchHit[] = [];
  forEachOccurrence(text, needle, (occurrence, start) => {
    hits.push({ start, end: start + needle.length, current: occurrence === current });
  });
  return hits;
}

function lineAt(lines: string[], index: number, path: string): string {
  const line = lines[index];
  if (line === undefined) {
    throw new Error(`diff search: ${path} has no line at index ${index}`);
  }
  return line;
}

function pushOccurrences(
  matches: DiffSearchMatch[],
  text: string,
  needle: string,
  build: (occurrence: number, index: number) => DiffSearchMatch,
) {
  forEachOccurrence(text, needle, (occurrence) => {
    matches.push(build(occurrence, matches.length));
  });
}

function emitContentMatches(
  matches: DiffSearchMatch[],
  path: string,
  needle: string,
  text: string,
  lineType: DiffSearchLineType,
  additionLineNumber: number,
  deletionLineNumber: number,
) {
  pushOccurrences(matches, text, needle, (occurrence, index) => ({
    index,
    path,
    kind: "content",
    lineType,
    additionLineNumber,
    deletionLineNumber,
    occurrence,
  }));
}

/**
 * Case-insensitive hits in the current scope. Path hits come before that
 * file's diff lines. Context lines count once. An empty query matches nothing.
 */
export function collectDiffSearchMatches(
  files: ReviewDiffFile[],
  diffs: Map<string, SearchableDiff>,
  query: string,
): DiffSearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const matches: DiffSearchMatch[] = [];
  for (const file of files) {
    if (file.oldPath && file.oldPath !== file.path) {
      pushOccurrences(matches, file.oldPath, needle, (occurrence, index) => ({
        index,
        path: file.path,
        kind: "path",
        field: "oldPath",
        occurrence,
      }));
    }
    pushOccurrences(matches, file.path, needle, (occurrence, index) => ({
      index,
      path: file.path,
      kind: "path",
      field: "path",
      occurrence,
    }));

    const diff = diffs.get(file.path);
    if (!diff || file.tooLarge) continue;

    for (const hunk of diff.hunks) {
      let additionLineNumber = hunk.additionStart;
      let deletionLineNumber = hunk.deletionStart;
      for (const segment of hunk.hunkContent) {
        if (segment.type === "context") {
          for (let i = 0; i < segment.lines; i += 1) {
            emitContentMatches(
              matches,
              file.path,
              needle,
              lineAt(diff.deletionLines, segment.deletionLineIndex + i, file.path),
              "context",
              additionLineNumber,
              deletionLineNumber,
            );
            additionLineNumber += 1;
            deletionLineNumber += 1;
          }
          continue;
        }
        for (let i = 0; i < segment.deletions; i += 1) {
          emitContentMatches(
            matches,
            file.path,
            needle,
            lineAt(diff.deletionLines, segment.deletionLineIndex + i, file.path),
            "change-deletion",
            additionLineNumber,
            deletionLineNumber,
          );
          deletionLineNumber += 1;
        }
        for (let i = 0; i < segment.additions; i += 1) {
          emitContentMatches(
            matches,
            file.path,
            needle,
            lineAt(diff.additionLines, segment.additionLineIndex + i, file.path),
            "change-addition",
            additionLineNumber,
            deletionLineNumber,
          );
          additionLineNumber += 1;
        }
      }
    }
  }
  return matches;
}

export function filesMatchingSearch(matches: DiffSearchMatch[]): Set<string> {
  return new Set(matches.map((match) => match.path));
}

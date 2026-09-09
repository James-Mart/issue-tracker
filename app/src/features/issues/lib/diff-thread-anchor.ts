import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs/react";
import type { CommentInput } from "@server/schemas";

export type AnchorSide = "old" | "new";

export type DiffThreadAnchor = {
  path: string;
  side: AnchorSide;
  line: number;
  startLine?: number;
  commitSha: string;
};

export type OpenDiffComposer =
  | ({ kind: "new" } & Omit<DiffThreadAnchor, "commitSha">)
  | { kind: "reply"; threadId: string };

export function annotationSideToAnchorSide(
  side: "deletions" | "additions",
): AnchorSide {
  return side === "deletions" ? "old" : "new";
}

export function pathForAnchorSide(
  file: Pick<FileDiffMetadata, "name" | "prevName">,
  side: AnchorSide,
): string {
  if (side === "old" && file.prevName) return file.prevName;
  return file.name;
}

/** Map a pierre line selection onto the comment-anchor write shape. */
export function selectedRangeToAnchor(
  range: SelectedLineRange,
  path: string,
  commitSha: string,
): DiffThreadAnchor {
  const startSide = range.side ?? range.endSide ?? "additions";
  const endSide = range.endSide ?? range.side ?? "additions";
  const side = annotationSideToAnchorSide(endSide);
  if (startSide !== endSide) {
    return { path, side, line: range.end, commitSha };
  }
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  if (start === end) {
    return { path, side, line: end, commitSha };
  }
  return { path, side, line: end, startLine: start, commitSha };
}

export function newThreadDraftId(
  anchor: Pick<DiffThreadAnchor, "path" | "side" | "line" | "startLine">,
): string {
  const span =
    anchor.startLine !== undefined
      ? `${anchor.startLine}-${anchor.line}`
      : String(anchor.line);
  return `${anchor.path}:${anchor.side}:${span}`;
}

export function threadDraftKey(kind: "new" | "reply", id: string): string {
  return `diff-thread-draft:${kind}:${id}`;
}

export function composerDraftKey(open: OpenDiffComposer): string {
  if (open.kind === "reply") return threadDraftKey("reply", open.threadId);
  return threadDraftKey("new", newThreadDraftId(open));
}

export function commentInputForComposer(
  open: OpenDiffComposer,
  body: string,
  commitSha: string,
): CommentInput {
  if (open.kind === "reply") {
    return { role: "human", body, replyTo: open.threadId };
  }
  return {
    role: "human",
    body,
    anchor: {
      path: open.path,
      side: open.side,
      line: open.line,
      commitSha,
      ...(open.startLine !== undefined ? { startLine: open.startLine } : {}),
    },
  };
}

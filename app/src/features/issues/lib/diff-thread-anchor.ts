import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs/react";
import type { CommentInput } from "@server/schemas";
import { questionKindFields } from "@server/question-kind";
import { replyDraftKey, reviewDraftKey } from "@/features/reviews/lib/review-draft-key";

export type AnchorSide = "old" | "new";

export type DiffThreadAnchor = {
  path: string;
  side: AnchorSide;
  line: number;
  startLine?: number;
  commitSha: string;
};

export type NewDiffComposer = { kind: "new" } & Omit<DiffThreadAnchor, "commitSha">;

export type OpenDiffComposer = NewDiffComposer | { kind: "reply"; threadId: string };

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

/** Every path an anchor on this file may carry: the new name, and the old one for a rename. */
export function fileAnchorPaths(file: Pick<FileDiffMetadata, "name" | "prevName">): string[] {
  if (file.prevName && file.prevName !== file.name) {
    return [file.name, file.prevName];
  }
  return [file.name];
}

export function composerOpensInFile(
  open: NewDiffComposer,
  file: Pick<FileDiffMetadata, "name" | "prevName">,
): boolean {
  return fileAnchorPaths(file).includes(open.path);
}

/** The new-thread composer when it is open on this file line, else null. */
export function newComposerOnLine(
  open: OpenDiffComposer | null,
  file: Pick<FileDiffMetadata, "name" | "prevName">,
  line: number,
  side: AnchorSide,
): NewDiffComposer | null {
  if (open?.kind !== "new" || open.line !== line || open.side !== side) return null;
  return composerOpensInFile(open, file) ? open : null;
}

/** Map a pierre line selection onto a new-thread composer on that side's path. */
export function newComposerForRange(
  range: SelectedLineRange,
  file: Pick<FileDiffMetadata, "name" | "prevName">,
): NewDiffComposer {
  const startSide = range.side ?? range.endSide ?? "additions";
  const endSide = range.endSide ?? range.side ?? "additions";
  const side = annotationSideToAnchorSide(endSide);
  const path = pathForAnchorSide(file, side);
  if (startSide !== endSide) {
    return { kind: "new", path, side, line: range.end };
  }
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  if (start === end) {
    return { kind: "new", path, side, line: end };
  }
  return { kind: "new", path, side, line: end, startLine: start };
}

export function composerDraftKey(
  reviewId: string,
  open: OpenDiffComposer,
): string {
  if (open.kind === "reply") {
    return replyDraftKey(reviewId, open.threadId);
  }
  const span =
    open.startLine !== undefined
      ? `${open.startLine}-${open.line}`
      : String(open.line);
  return reviewDraftKey(reviewId, `line:${open.path}:${open.side}:${span}`);
}

export function commentInputForComposer(
  open: OpenDiffComposer,
  body: string,
  commitSha: string,
  kind?: "question",
): CommentInput {
  if (open.kind === "reply") {
    return { role: "human", body, replyTo: open.threadId };
  }
  return {
    role: "human",
    body,
    ...questionKindFields(kind),
    anchor: {
      path: open.path,
      side: open.side,
      line: open.line,
      commitSha,
      ...(open.startLine !== undefined ? { startLine: open.startLine } : {}),
    },
  };
}

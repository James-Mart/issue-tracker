import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs/react";
import type { CommentInput } from "@server/schemas";
import { questionKindFields } from "@server/question-kind";
import { replyDraftKey, reviewDraftKey } from "@/features/reviews/lib/review-draft-key";
import { quoteCommentInput, type QuoteSource } from "./quote-comment";

export type AnchorSide = "old" | "new";

/** New line thread. `startLine` is set only for a same-side range. */
export type NewLineComposer = {
  kind: "new";
  path: string;
  side: AnchorSide;
  line: number;
  startLine?: number;
};

/** New file thread. `side` and `line` are both absent. */
export type NewFileComposer = {
  kind: "new";
  path: string;
};

export type NewDiffComposer = NewLineComposer | NewFileComposer;

export type QuoteDiffComposer = { kind: "quote" } & QuoteSource;

export type OpenDiffComposer =
  | NewDiffComposer
  | { kind: "reply"; threadId: string }
  | QuoteDiffComposer;

export function quoteDiffComposer(
  source: QuoteSource,
): QuoteDiffComposer {
  return { kind: "quote", ...source };
}

export function isLineComposer(open: NewDiffComposer): open is NewLineComposer {
  return "line" in open;
}

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
): NewLineComposer | null {
  if (open?.kind !== "new" || !isLineComposer(open)) return null;
  if (open.line !== line || open.side !== side) return null;
  return composerOpensInFile(open, file) ? open : null;
}

/** The new file composer when it is open on this path, else null. */
export function newFileComposerOnFile(
  open: OpenDiffComposer | null,
  path: string,
): NewFileComposer | null {
  if (open?.kind !== "new" || isLineComposer(open) || open.path !== path) return null;
  return open;
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
  if (open.kind === "reply" || open.kind === "quote") {
    return replyDraftKey(reviewId, open.threadId);
  }
  if (!isLineComposer(open)) {
    return reviewDraftKey(reviewId, `file:${open.path}`);
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
  if (open.kind === "quote") {
    return quoteCommentInput(body, open.anchor);
  }
  if (!isLineComposer(open)) {
    return {
      role: "human",
      body,
      ...questionKindFields(kind),
      anchor: { path: open.path, commitSha },
    };
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

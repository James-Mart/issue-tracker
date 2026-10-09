import type { CommentAnchor, CommentInput } from "@server/schemas";
import { isLineAnchor } from "./comment-anchor";

/** Caption for a quote composer. A line anchor names the file and that line. */
export function quoteComposerLabel(anchor: CommentAnchor | undefined): string {
  if (anchor && isLineAnchor(anchor)) {
    return `New thread on ${anchor.path} · line ${anchor.line}`;
  }
  if (anchor) return `New thread on ${anchor.path}`;
  return "New comment";
}

/** The stored anchor, including an outdated thread's commit. */
export function copyCommentAnchor(anchor: CommentAnchor): CommentAnchor {
  if (!isLineAnchor(anchor)) {
    return { path: anchor.path, commitSha: anchor.commitSha };
  }
  return {
    path: anchor.path,
    side: anchor.side,
    line: anchor.line,
    commitSha: anchor.commitSha,
    ...(anchor.startLine !== undefined ? { startLine: anchor.startLine } : {}),
  };
}

/** New review thread when the source has an anchor; otherwise a new unanchored comment. */
export function quoteCommentInput(
  body: string,
  anchor: CommentAnchor | undefined,
): CommentInput {
  if (!anchor) return { role: "human", body };
  return { role: "human", body, anchor: copyCommentAnchor(anchor) };
}

export type QuoteSource = {
  threadId: string;
  commentId: string;
  body: string;
  anchor?: CommentAnchor;
};

export function quoteSource(
  threadId: string,
  comment: { id: string; body: string },
  anchor: CommentAnchor | undefined,
): QuoteSource {
  return {
    threadId,
    commentId: comment.id,
    body: comment.body,
    anchor,
  };
}

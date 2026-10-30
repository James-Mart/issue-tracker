import type { CommentAnchor, CommentInput } from "@server/schemas";
import { questionKindFields } from "@server/question-kind";
import { quoteDraftKey } from "@/features/reviews/lib/review-draft-key";
import {
  replaceReviewDraft,
  reviewDraft,
  reviewDraftHasText,
} from "@/features/reviews/lib/review-draft-storage";
import { isLineAnchor } from "./comment-anchor";

/** Caption for a quote composer. `outdated` applies only when an anchor was copied. */
export function quoteComposerLabel(
  anchor: CommentAnchor | undefined,
  outdated = false,
): string {
  if (!anchor) return "New thread";
  const label = isLineAnchor(anchor)
    ? `New thread on ${anchor.path} · line ${anchor.line}`
    : `New thread on ${anchor.path}`;
  return outdated ? `${label} (outdated)` : label;
}

/** Quoted lines as a markdown blockquote, then a blank line to write on. */
export function quoteBlockquote(body: string): string {
  const lines = body.replace(/\n$/, "").split("\n");
  return `${lines.map((line) => `> ${line}`).join("\n")}\n\n`;
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
  kind?: "question",
): CommentInput {
  const question = questionKindFields(kind);
  if (!anchor) return { role: "human", body, ...question };
  return { role: "human", body, ...question, anchor: copyCommentAnchor(anchor) };
}

export type QuoteSource = {
  threadId: string;
  commentId: string;
  body: string;
  anchor?: CommentAnchor;
  /** The copied anchor no longer matches the diff. */
  outdated?: boolean;
};

export function quoteSource(
  threadId: string,
  comment: { id: string; body: string },
  anchor: CommentAnchor | undefined,
  outdated = false,
): QuoteSource {
  return {
    threadId,
    commentId: comment.id,
    body: comment.body,
    anchor,
    ...(outdated ? { outdated: true } : {}),
  };
}

/** Writes the blockquote only when this comment has no unsent draft yet. */
export function seedQuoteDraft(issueId: string, source: QuoteSource): void {
  const key = quoteDraftKey(issueId, source.commentId);
  if (reviewDraftHasText(reviewDraft(key))) return;
  replaceReviewDraft(key, quoteBlockquote(source.body));
}

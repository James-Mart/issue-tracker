import type { CommentInput, IssueKind } from "@server/schemas";
import { kindHas } from "@server/kind";
import { questionKindFields } from "@server/question-kind";

/** Top-level human comment, optionally posted as a question. */
export function humanComment(body: string, kind?: "question"): CommentInput {
  return { role: "human", body, ...questionKindFields(kind) };
}

/**
 * Kinds that show the inline comments section on issue detail.
 * Narrower than comments storage — a Project keeps no comments UI.
 */
export function supportsComments(kind: IssueKind): boolean {
  return kindHas(kind, "comment");
}

export function commentCountLabel(count: number): string {
  return count === 1 ? "1 comment" : `${count} comments`;
}

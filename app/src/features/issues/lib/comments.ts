import type { IssueKind } from "@server/schemas";
import { kindHas } from "@server/kind";

/**
 * Kinds that show the inline comments section on issue detail.
 * Narrower than comments storage — a Project keeps no comments UI.
 */
export function supportsComments(kind: IssueKind): boolean {
  return kindHas(kind, "comment");
}

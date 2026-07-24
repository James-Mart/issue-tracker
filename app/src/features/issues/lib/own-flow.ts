import type { IssueKind } from "@server/schemas";

/**
 * Kinds that show an own-flow area in the detail primary column.
 * Idea, Task, and Project leave the slot empty.
 */
export function kindHasOwnFlow(kind: IssueKind): boolean {
  return kind === "epic" || kind === "story";
}

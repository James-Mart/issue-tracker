import type { Issue } from "../schemas.js";
import { appendTargetOutlineId } from "./append-target.js";

/**
 * The outline an archived Idea concluded onto. An Idea's own outline carries
 * `concludedAt`; an append Idea concluded when conclude recorded its verdict,
 * and its outline is the target Story's. Title falls back to the id when that
 * outline's record is not in `issues`.
 */
export function concludedPlanningOutline(
  issues: readonly Issue[],
  idea: Extract<Issue, { kind: "idea" }>,
): { id: string; title: string } | undefined {
  if (idea.appendTo) {
    if (idea.codeApprovalRequired === undefined) return undefined;
    const id = appendTargetOutlineId(issues, idea.appendTo);
    if (!id) return undefined;
    const title = issues.find((issue) => issue.id === id)?.title ?? id;
    return { id, title };
  }
  const outline = issues.find(
    (issue): issue is Extract<Issue, { kind: "outline" }> =>
      issue.kind === "outline" &&
      issue.sourceIdea === idea.id &&
      issue.concludedAt !== undefined,
  );
  if (!outline) return undefined;
  return { id: outline.id, title: outline.title };
}

export function concludedOutlineId(
  issues: readonly Issue[],
  idea: Extract<Issue, { kind: "idea" }>,
): string | undefined {
  return concludedPlanningOutline(issues, idea)?.id;
}

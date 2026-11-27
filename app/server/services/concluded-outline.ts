import type { Issue } from "../schemas.js";

/**
 * The outline an archived Idea concluded onto: the outline whose `sourceIdea`
 * is this Idea and whose `concludedAt` is set.
 */
export function concludedPlanningOutline(
  issues: readonly Issue[],
  idea: Extract<Issue, { kind: "idea" }>,
): { id: string; title: string } | undefined {
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

import type { Issue, IssueKind } from "../schemas.js";
import { readDescription } from "./issues.js";

export type PlanningWorkRoot = {
  id: string;
  title: string;
  kind: Extract<IssueKind, "epic" | "story">;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when a root description backlinks the Idea via `issue:<ideaId>`. */
export function descriptionBacklinksIdea(
  description: string,
  ideaId: string,
): boolean {
  const pattern = new RegExp(`\\(issue:${escapeRegExp(ideaId)}\\)`);
  return pattern.test(description);
}

/**
 * Epic or project-level Story in the Idea's Project whose description
 * backlinks the Idea — the work root a planning session produces.
 */
export function findPlanningWorkRoot(
  ideaId: string,
  issues: Issue[],
): PlanningWorkRoot | null {
  const idea = issues.find((entry) => entry.id === ideaId);
  if (!idea || idea.kind !== "idea") return null;

  const projectId = idea.partOf;

  for (const issue of issues) {
    if (issue.partOf !== projectId) continue;
    if (issue.kind === "epic") {
      if (descriptionBacklinksIdea(readDescription(issue.id), ideaId)) {
        return { id: issue.id, title: issue.title, kind: "epic" };
      }
      continue;
    }
    if (issue.kind === "story") {
      const description = readDescription(issue.id);
      if (descriptionBacklinksIdea(description, ideaId)) {
        return { id: issue.id, title: issue.title, kind: "story" };
      }
    }
  }

  return null;
}

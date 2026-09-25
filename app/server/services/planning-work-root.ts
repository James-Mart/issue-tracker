import type { Issue, IssueKind } from "../schemas.js";

export type PlanningWorkRoot = {
  id: string;
  title: string;
  kind: Extract<IssueKind, "epic" | "story">;
};

type PlanRootIssue = Extract<Issue, { kind: "epic" | "story" }>;

function isPlanRootKind(issue: Issue): issue is PlanRootIssue {
  return issue.kind === "epic" || issue.kind === "story";
}

function isPlanRootCandidate(issue: PlanRootIssue, projectId: string): boolean {
  if (issue.partOf !== projectId) return false;
  return issue.kind === "epic" || !issue.stackedOn;
}

/**
 * Epic or project-level Story in the Idea's Project whose stored `sourceIdea`
 * points at the Idea — the work root a planning session produces.
 */
export function findPlanningWorkRoot(
  ideaId: string,
  issues: Issue[],
): PlanningWorkRoot | null {
  const idea = issues.find((entry) => entry.id === ideaId);
  if (!idea || idea.kind !== "idea") return null;

  const projectId = idea.partOf;
  let best: PlanningWorkRoot | null = null;
  let bestOrder = Infinity;

  for (const issue of issues) {
    if (!isPlanRootKind(issue)) continue;
    if (issue.sourceIdea !== ideaId) continue;
    if (!isPlanRootCandidate(issue, projectId)) continue;
    if (issue.order >= bestOrder) continue;
    bestOrder = issue.order;
    best = {
      id: issue.id,
      title: issue.title,
      kind: issue.kind,
    };
  }

  return best;
}

/** Idea ids with at least one Epic or root Story whose `sourceIdea` points back. */
export function ideaIdsWithPlanRoot(issues: Issue[]): Set<string> {
  const planned = new Set<string>();
  const ideasById = new Map<string, Extract<Issue, { kind: "idea" }>>();
  for (const issue of issues) {
    if (issue.kind === "idea") ideasById.set(issue.id, issue);
  }

  for (const issue of issues) {
    if (!isPlanRootKind(issue)) continue;
    if (!issue.sourceIdea || planned.has(issue.sourceIdea)) continue;
    const idea = ideasById.get(issue.sourceIdea);
    if (!idea) continue;
    if (!isPlanRootCandidate(issue, idea.partOf)) continue;
    planned.add(issue.sourceIdea);
  }

  return planned;
}

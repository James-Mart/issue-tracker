import type { Issue, IssueKind } from "../schemas.js";

export type PlanningWorkRoot = {
  id: string;
  title: string;
  kind: Extract<IssueKind, "epic" | "story">;
};

type PlanRootIssue = Extract<Issue, { kind: "epic" | "story" }>;
type IdeaRecord = Extract<Issue, { kind: "idea" }>;

function isPlanRootKind(issue: Issue): issue is PlanRootIssue {
  return issue.kind === "epic" || issue.kind === "story";
}

function isPlanRootCandidate(issue: PlanRootIssue, projectId: string): boolean {
  if (issue.partOf !== projectId) return false;
  return issue.kind === "epic" || !issue.stackedOn;
}

function ideasByIdFrom(issues: Issue[]): Map<string, IdeaRecord> {
  const byId = new Map<string, IdeaRecord>();
  for (const issue of issues) {
    if (issue.kind === "idea") byId.set(issue.id, issue);
  }
  return byId;
}

/** Idea ids with an outline link vs an Epic/root Story plan-root link, one pass. */
export function ideaPlanningArtifactIds(issues: Issue[]): {
  outlined: Set<string>;
  planned: Set<string>;
} {
  const ideasById = ideasByIdFrom(issues);
  const outlined = new Set<string>();
  const planned = new Set<string>();

  for (const issue of issues) {
    if (issue.kind === "outline") {
      if (!issue.sourceIdea || outlined.has(issue.sourceIdea)) continue;
      const idea = ideasById.get(issue.sourceIdea);
      if (!idea || issue.partOf !== idea.partOf) continue;
      outlined.add(issue.sourceIdea);
      planned.delete(issue.sourceIdea);
      continue;
    }
    if (!isPlanRootKind(issue)) continue;
    if (!issue.sourceIdea || outlined.has(issue.sourceIdea) || planned.has(issue.sourceIdea)) {
      continue;
    }
    const idea = ideasById.get(issue.sourceIdea);
    if (!idea) continue;
    if (!isPlanRootCandidate(issue, idea.partOf)) continue;
    planned.add(issue.sourceIdea);
  }

  return { outlined, planned };
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

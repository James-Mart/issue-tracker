import type { Issue } from "../schemas.js";

type IdeaIssue = Extract<Issue, { kind: "idea" }>;
type OutlineIssue = Extract<Issue, { kind: "outline" }>;

/** The outline carrying the Idea's plan settings that later steps read; `decompositionGate` stays on the Idea. */
export function withIdeaPlanSettings(
  outline: OutlineIssue,
  idea: IdeaIssue,
  codeApprovalRequired: boolean,
): OutlineIssue {
  const next: OutlineIssue = {
    ...outline,
    executionGate: idea.executionGate,
    codeApprovalRequired,
    outOfBand: idea.outOfBand,
  };
  if (idea.mergeBase === undefined) delete next.mergeBase;
  else next.mergeBase = idea.mergeBase;
  if (idea.mergePolicy === undefined) delete next.mergePolicy;
  else next.mergePolicy = idea.mergePolicy;
  return next;
}

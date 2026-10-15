import type { StandardsAssessment } from "./schemas/review.js";

type StandardsProposal = StandardsAssessment["proposals"][number];

type DecisionFields = Pick<StandardsProposal, "decision" | "feedback" | "withdrawn">;

export const WORKSPACE_STANDARDS_SUBMIT_REASON =
  "Workspace-backed standards cannot be auto-applied";

export const ITERATE_FEEDBACK_SUBMIT_REASON =
  "Add feedback to every proposal marked Iterate before submitting.";

/** An Iterate mark counts only with feedback that is not blank. */
export function iterateMarkComplete(proposal: DecisionFields): boolean {
  return proposal.decision === "iterate" && (proposal.feedback?.trim() ?? "").length > 0;
}

/** Withdrawn proposals need no decision; an Iterate mark needs its feedback. */
export function everyProposalDecided(proposals: readonly DecisionFields[]): boolean {
  return proposals.every(
    (proposal) =>
      proposal.withdrawn === true ||
      proposal.decision === "accepted" ||
      proposal.decision === "rejected" ||
      iterateMarkComplete(proposal),
  );
}

export function someIterateMarkIncomplete(proposals: readonly DecisionFields[]): boolean {
  return proposals.some(
    (proposal) =>
      proposal.withdrawn !== true &&
      proposal.decision === "iterate" &&
      !iterateMarkComplete(proposal),
  );
}

/** Proposed wording as it stands: the human's edit, else the assessor's `after`. */
export function proposalAfterText(
  proposal: Pick<StandardsProposal, "after" | "editedAfter">,
): string {
  return proposal.editedAfter ?? proposal.after;
}

import type { StandardsAssessment } from "./schemas/review.js";

type StandardsProposal = StandardsAssessment["proposals"][number];

export const WORKSPACE_STANDARDS_SUBMIT_REASON =
  "Workspace-backed standards cannot be auto-applied";

export function everyProposalDecided(
  proposals: readonly Pick<StandardsProposal, "decision">[],
): boolean {
  return proposals.every((proposal) => proposal.decision !== undefined);
}

/** Proposed wording as it stands: the human's edit, else the assessor's `after`. */
export function proposalAfterText(
  proposal: Pick<StandardsProposal, "after" | "editedAfter">,
): string {
  return proposal.editedAfter ?? proposal.after;
}

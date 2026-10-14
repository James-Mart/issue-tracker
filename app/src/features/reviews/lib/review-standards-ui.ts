import type { ReviewSubmission, StandardsAssessment } from "@server/schemas";
import { countLabel } from "./review-submission-ui";

export type StandardsProposal = StandardsAssessment["proposals"][number];

export type StandardsGroup = {
  submissionId: string;
  /** Position among all of the review's submissions, as the header's open rounds count it. */
  round: number;
  at: string;
  standards: StandardsAssessment;
};

/**
 * One group per assessed submission, newest first. `applied` groups are
 * `submitted`; every other status stays `open`.
 */
export function standardsGroups(
  submissions: readonly Pick<ReviewSubmission, "id" | "at" | "standards">[],
): { open: StandardsGroup[]; submitted: StandardsGroup[] } {
  const groups = submissions
    .flatMap((submission, index) =>
      submission.standards
        ? [
            {
              submissionId: submission.id,
              round: index + 1,
              at: submission.at,
              standards: submission.standards,
            },
          ]
        : [],
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const open: StandardsGroup[] = [];
  const submitted: StandardsGroup[] = [];
  for (const group of groups) {
    (group.standards.status === "applied" ? submitted : open).push(group);
  }
  return { open, submitted };
}

/** Decisions and edits are writable only while the assessment is `ready`. */
export function standardsGroupEditable(standards: StandardsAssessment): boolean {
  return standards.status === "ready";
}

/** Proposed wording as it stands: the human's edit, else the assessor's `after`. */
export function proposalAfterText(proposal: Pick<StandardsProposal, "after" | "editedAfter">): string {
  return proposal.editedAfter ?? proposal.after;
}

export function showSubmittedGroupsLabel(count: number): string {
  return `Show ${countLabel(count, "submitted group", "submitted groups")}`;
}

/** File name the doc snapshot points at, for diff language detection. */
export function standardsDocFileName(doc: StandardsAssessment["doc"]): string {
  return doc.type === "attachment" ? doc.name : doc.path;
}

/**
 * Body for saving an inline edit, or `null` when nothing would change.
 * Wording equal to the assessor's `after` clears the edit. A blank draft
 * is discarded like Cancel: a proposal with added text keeps some.
 */
export function proposalEditBody(
  proposal: Pick<StandardsProposal, "after" | "editedAfter">,
  draft: string,
): { editedAfter: string | null } | null {
  if (draft.trim().length === 0) return null;
  const next = draft === proposal.after ? null : draft;
  if (next === (proposal.editedAfter ?? null)) return null;
  return { editedAfter: next };
}

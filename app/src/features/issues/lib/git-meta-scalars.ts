import { CHIP_UNSET, FIELD_LABELS } from "@server/fields";
import type { IssueDetail } from "@server/schemas";

/** Keys rendered in the detail compact git/spec meta block. */
export type GitMetaScalarKey =
  | "branchName"
  | "mergeBase"
  | "stackedOn"
  | "prUrl"
  | "merged"
  | "specReview"
  | "commitSha"
  | "noDiff"
  | "qa";

export type GitMetaScalar = {
  key: GitMetaScalarKey;
  label: string;
};

/**
 * Which git/spec scalars to show for a Story. Readonly values only when set;
 * `merged` and `stackedOn` always (editable).
 */
export function storyGitMetaScalars(
  issue: Extract<IssueDetail, { kind: "story" }>,
  mergeBase?: string,
): GitMetaScalar[] {
  const out: GitMetaScalar[] = [];
  if (issue.branchName) {
    out.push({ key: "branchName", label: FIELD_LABELS.branchName });
  }
  if (mergeBase && mergeBase !== CHIP_UNSET) {
    out.push({ key: "mergeBase", label: FIELD_LABELS.mergeBase });
  }
  out.push({ key: "stackedOn", label: FIELD_LABELS.stackedOn });
  if (issue.prUrl) {
    out.push({ key: "prUrl", label: FIELD_LABELS.prUrl });
  }
  out.push({ key: "merged", label: FIELD_LABELS.merged });
  if (issue.specReview) {
    out.push({ key: "specReview", label: FIELD_LABELS.specReview });
  }
  return out;
}

/**
 * Which git/spec scalars to show for a Task. Readonly values only when set;
 * parent `branchName` when the parent Story has one.
 */
export function taskGitMetaScalars(
  issue: Extract<IssueDetail, { kind: "task" }>,
  parentBranchName?: string,
): GitMetaScalar[] {
  const out: GitMetaScalar[] = [];
  if (parentBranchName) {
    out.push({ key: "branchName", label: FIELD_LABELS.branchName });
  }
  if (issue.commitSha) {
    out.push({ key: "commitSha", label: FIELD_LABELS.commitSha });
  }
  if (issue.noDiff) {
    out.push({ key: "noDiff", label: FIELD_LABELS.noDiff });
  }
  if (issue.qa) {
    out.push({ key: "qa", label: FIELD_LABELS.qa });
  }
  return out;
}

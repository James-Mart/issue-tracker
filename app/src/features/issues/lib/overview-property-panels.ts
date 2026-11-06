import { kindHas, hasAssignee, hasAttention } from "@server/kind";
import type { IssueDetail } from "@server/schemas";
import { isLabelAssignableIssue } from "./project-labels";

/**
 * Stable ids for Overview property rows. Used for ordering and for
 * `overviewPropertyRows` (Story contract: classified once, panels render in outline order).
 */
export type OverviewPropertyRowId =
  | "partOf"
  | "sourceIdea"
  | "sourceOutline"
  | "assignee"
  | "labels"
  | "appendTo"
  | "stakeholder"
  | "generatedIssues"
  | "codeApprovalRequired"
  | "needsAttention"
  | "attentionReason"
  | "mergeSettings"
  | "git";

export type EpicMergeSettingsPanel = "editable" | "fixed" | "omit";

/**
 * Which detail Overview rows belong in the editable vs fixed panel for this issue.
 * Git/stack rows (`git`) are rendered by `GitStackPanel`; see that module for split details.
 *
 * Epic merge base / merge policy: `epicMergeSettings` — editable while unlocked, fixed once locked;
 * omit when there are no root merge settings rows.
 */
export function overviewPropertyRows(
  issue: IssueDetail,
  epicMergeSettings: EpicMergeSettingsPanel = "omit",
): { editable: OverviewPropertyRowId[]; fixed: OverviewPropertyRowId[] } {
  const editable: OverviewPropertyRowId[] = [];
  const fixed: OverviewPropertyRowId[] = [];

  if (
    kindHas(issue.kind, "detailPartOf") &&
    (issue.kind === "epic" || issue.kind === "story" || issue.kind === "task")
  ) {
    editable.push("partOf");
  }

  if (issue.kind === "epic" || issue.kind === "story") {
    fixed.push("sourceIdea");
  }

  if (issue.kind === "epic" || issue.kind === "story" || issue.kind === "task") {
    fixed.push("sourceOutline");
  }

  if (hasAssignee(issue)) {
    editable.push("assignee");
  }

  if (isLabelAssignableIssue(issue)) {
    editable.push("labels");
  }

  if (issue.kind === "idea") {
    editable.push("appendTo", "stakeholder");
    fixed.push("generatedIssues");
    if (issue.codeApprovalRequired === true) {
      fixed.push("codeApprovalRequired");
    }
  }

  if (hasAttention(issue)) {
    editable.push("needsAttention");
    if (issue.needsAttention) {
      editable.push("attentionReason");
    }
  }

  if (issue.kind === "epic" && epicMergeSettings !== "omit") {
    if (epicMergeSettings === "editable") {
      editable.push("mergeSettings");
    } else {
      fixed.push("mergeSettings");
    }
  }

  if (issue.kind === "story") {
    editable.push("git");
    fixed.push("git");
  } else if (issue.kind === "task") {
    fixed.push("git");
  }

  return { editable, fixed };
}

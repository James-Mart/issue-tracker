import { bySequenceThenId, isProjectBoardChild } from "@server/order";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { visibleIssues } from "@server/services/archived-visibility";
import { issuesById } from "./build-tree";
import { isIssueComplete } from "./derived";

/** A root Epic or project-level Story stamped with one outline. */
export type LinkedRoot = {
  id: string;
  kind: "epic" | "story";
  title: string;
  version: number;
  behind: boolean;
  open: boolean;
  order: number;
};

type StampedBoardRoot = Extract<IssueRecord, { kind: "epic" | "story" }> & {
  sourceOutline: { outline: string; version: number };
};

function stampedBoardRoot(
  issue: IssueRecord,
  byId: Map<string, IssueRecord>,
): issue is StampedBoardRoot {
  if (issue.kind !== "epic" && issue.kind !== "story") return false;
  if (!issue.sourceOutline) return false;
  return isProjectBoardChild(issue, byId);
}

/**
 * Root Epics and project-level Stories whose `sourceOutline` names this
 * outline. Nested Stories, stacked Stories, and Tasks stay off the list.
 * Order matches the project board. `behind` is the derived flag; `open`
 * means the root is not yet complete (Epic not done, Story not merged).
 */
export function linkedRootsForOutline(
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
  outlineId: string,
  showArchived: boolean,
): LinkedRoot[] {
  const byId = issuesById(issues);
  const roots: LinkedRoot[] = [];
  for (const issue of visibleIssues(issues, showArchived)) {
    if (!stampedBoardRoot(issue, byId)) continue;
    if (issue.sourceOutline.outline !== outlineId) continue;
    roots.push({
      id: issue.id,
      kind: issue.kind,
      title: issue.title,
      version: issue.sourceOutline.version,
      behind: derived[issue.id]?.behind === true,
      open: !isIssueComplete(issue, derived[issue.id]),
      order: issue.order,
    });
  }
  roots.sort(bySequenceThenId);
  return roots;
}

/**
 * Catalog "Linked work" cell. Zero stays `0 roots`. A mix reads
 * `1 epic · 2 root stories`.
 */
export function linkedWorkCountLabel(epics: number, stories: number): string {
  const parts: string[] = [];
  if (epics > 0) parts.push(epics === 1 ? "1 epic" : `${epics} epics`);
  if (stories > 0) {
    parts.push(stories === 1 ? "1 root story" : `${stories} root stories`);
  }
  return parts.length > 0 ? parts.join(" · ") : "0 roots";
}

/** One pass: each outline id → its catalog linked-work label. */
export function linkedWorkLabels(
  issues: IssueRecord[],
  showArchived: boolean,
): Map<string, string> {
  const byId = issuesById(issues);
  const counts = new Map<string, { epics: number; stories: number }>();
  for (const issue of visibleIssues(issues, showArchived)) {
    if (!stampedBoardRoot(issue, byId)) continue;
    const outlineId = issue.sourceOutline.outline;
    const bucket = counts.get(outlineId) ?? { epics: 0, stories: 0 };
    if (issue.kind === "epic") bucket.epics += 1;
    else bucket.stories += 1;
    counts.set(outlineId, bucket);
  }
  const labels = new Map<string, string>();
  for (const [outlineId, count] of counts) {
    labels.set(outlineId, linkedWorkCountLabel(count.epics, count.stories));
  }
  return labels;
}

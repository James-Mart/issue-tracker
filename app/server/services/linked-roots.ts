import { bySequenceThenId, isProjectBoardChild } from "../order.js";
import type { DerivedState, Issue } from "../schemas.js";
import { isArchived, visibleIssues } from "./archived-visibility.js";
import { isIssueComplete } from "./issue-complete.js";

/** A root Epic or project-level Story whose `sourceOutline` names an outline. */
export type StampedBoardRoot = {
  id: string;
  outlineId: string;
  kind: "epic" | "story";
  title: string;
  version: number;
  behind: boolean;
  /** Not yet complete: story not merged, epic status not done. */
  open: boolean;
  archived: boolean;
  order: number;
};

/**
 * Stamped board roots in board order. `showArchived` false matches
 * `issue outline open-roots`. `behind` and `open` read `derived`.
 */
export function stampedBoardRoots(
  issues: readonly Issue[],
  derived: Record<string, DerivedState>,
  showArchived: boolean,
): StampedBoardRoot[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const roots: StampedBoardRoot[] = [];
  for (const issue of visibleIssues(issues, showArchived)) {
    if (issue.kind !== "epic" && issue.kind !== "story") continue;
    if (!issue.sourceOutline || !isProjectBoardChild(issue, byId)) continue;
    const state = derived[issue.id];
    roots.push({
      id: issue.id,
      outlineId: issue.sourceOutline.outline,
      kind: issue.kind,
      title: issue.title,
      version: issue.sourceOutline.version,
      behind: state?.behind === true,
      open: !isIssueComplete(issue, state),
      archived: isArchived(issue),
      order: issue.order,
    });
  }
  roots.sort(bySequenceThenId);
  return roots;
}

import type { IssueRecord } from "@server/schemas";
import { bySequence, isProjectBoardChild } from "@server/order";
import {
  boardKindAllows,
  type BoardKindFilter,
} from "./board-kind-filter";

/** Project-board roots (Epic / Idea / project-level Story) in shared `order`. */
export function projectBoardRoots(
  issues: IssueRecord[],
  filter: BoardKindFilter,
): IssueRecord[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  return issues
    .filter((issue) => isProjectBoardChild(issue, byId))
    .filter((issue) => boardKindAllows(issue.kind, filter))
    .sort(bySequence);
}

import type { IssueDetail, IssueRecord } from "@server/schemas";
import { bySequence } from "@server/order";
import { issuesById, projectIdOf } from "./build-tree";

/** Project + Epics in the Story's project — valid `partOf` targets. */
export function storyPartOfOptions(
  issue: Extract<IssueDetail, { kind: "story" }> | Extract<IssueRecord, { kind: "story" }>,
  issues: IssueRecord[],
): IssueRecord[] {
  const byId = issuesById(issues);
  const projectId = projectIdOf(issue.id, byId);
  if (!projectId) return [];
  const options = issues.filter(
    (candidate) =>
      candidate.id === projectId ||
      (candidate.kind === "epic" && candidate.partOf === projectId),
  );
  if (
    issue.partOf &&
    !options.some((candidate) => candidate.id === issue.partOf)
  ) {
    const current = byId.get(issue.partOf);
    if (current) options.push(current);
  }
  return options.sort(bySequence);
}

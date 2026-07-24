import type { IssueRecord } from "@server/schemas";
import { parentOf } from "./build-tree";

/** Keep issues matching `matches`, plus containment / stack ancestors. */
export function filterWithAncestors(
  issues: IssueRecord[],
  matches: (issue: IssueRecord) => boolean,
): IssueRecord[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const keep = new Set<string>();
  const retain = (issue: IssueRecord): void => {
    let current: IssueRecord | undefined = issue;
    while (current && !keep.has(current.id)) {
      keep.add(current.id);
      // Retain the containment parent and, for a branch, the branch it forks
      // from, so a matched nested branch keeps its stack ancestors and nests.
      if (current.kind === "story" && current.stackedOn) {
        const base = byId.get(current.stackedOn);
        if (base) retain(base);
      }
      const parent = parentOf(current);
      current = parent ? byId.get(parent) : undefined;
    }
  };
  for (const issue of issues) {
    if (!matches(issue)) continue;
    retain(issue);
  }
  return issues.filter((issue) => keep.has(issue.id));
}

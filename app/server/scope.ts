import type { IssueRecord } from "./schemas.js";
import { subtreeIds } from "./services/subtree.js";

type StoryRecord = Extract<IssueRecord, { kind: "story" }>;

// Shared `tree` / `list` scope: optional positional id after kind checks.
// Story scope carries the record so tree render does not re-look it up.
export type BoardScope =
  | { kind: "all" }
  | { kind: "project"; projectId: string }
  | { kind: "epic"; epicId: string }
  | { kind: "story"; story: StoryRecord };

export function resolveBoardScope(
  id: string | undefined,
  issues: IssueRecord[],
  verb: "tree" | "list",
): BoardScope {
  if (!id) return { kind: "all" };
  const issue = issues.find((candidate) => candidate.id === id);
  if (!issue) throw new Error(`unknown issue "${id}"`);
  switch (issue.kind) {
    case "project":
      return { kind: "project", projectId: issue.id };
    case "epic":
      return { kind: "epic", epicId: issue.id };
    case "story":
      return { kind: "story", story: issue };
    case "idea":
      throw new Error(
        `cannot scope ${verb} to an idea; pass project "${issue.partOf}" instead`,
      );
    case "task":
      throw new Error(
        `cannot scope ${verb} to a task; pass story "${issue.partOf}" or its epic instead`,
      );
  }
}

export function scopeIssueIds(scope: BoardScope, issues: IssueRecord[]): Set<string> {
  switch (scope.kind) {
    case "all":
      return new Set(issues.map((issue) => issue.id));
    case "project":
      return subtreeIds(issues, scope.projectId);
    case "epic":
      return subtreeIds(issues, scope.epicId);
    case "story":
      return subtreeIds(issues, scope.story.id);
  }
}

export function assertScopeVisible(scope: BoardScope, visibleIds: Set<string>): void {
  if (scope.kind === "epic" && !visibleIds.has(scope.epicId)) {
    throw new Error(`epic "${scope.epicId}" is archived; pass --show-archived`);
  }
  if (scope.kind === "story" && !visibleIds.has(scope.story.id)) {
    throw new Error(
      `story "${scope.story.id}" is archived; pass --show-archived`,
    );
  }
}

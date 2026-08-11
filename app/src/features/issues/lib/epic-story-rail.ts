import type { DerivedState, IssueRecord } from "@server/schemas";
import { issuesById, nestParentOf, orderSiblings } from "./build-tree";
import { isInFlight } from "./derived";
import { issueRailNodeState, type RailNodeState } from "./rail-state";

export type { RailNodeState };

type StoryRecord = Extract<IssueRecord, { kind: "story" }>;
type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

export type EpicRailStory = {
  story: StoryRecord;
  depth: number;
};

/**
 * Map an Epic child Story onto a Rail port state via shared derived helpers.
 * When a Story's own task is in flight, surface in-flight even if derived
 * storyStatus has not advanced past not-started (no branchName yet).
 */
export function storyRailNodeState(
  story: StoryRecord,
  derived: DerivedState | undefined,
  issues?: readonly IssueRecord[],
): RailNodeState {
  const base = issueRailNodeState(story, derived);
  if (
    base === "merged" ||
    base === "blocked" ||
    base === "needs-attention"
  ) {
    return base;
  }
  if (issues) {
    const tasks = issues.filter(
      (issue): issue is TaskRecord =>
        issue.kind === "task" && issue.partOf === story.id,
    );
    if (tasks.some((task) => isInFlight(task, undefined))) return "in-flight";
  }
  return base;
}

/**
 * Epic Stories in Structure-matching nest order (DFS) with depth per row.
 * Membership is still `partOf` the Epic; nesting uses `nestParentOf`.
 */
export function epicStoriesForRail(
  epicId: string,
  issues: readonly IssueRecord[],
): EpicRailStory[] {
  const stories = issues.filter(
    (issue): issue is StoryRecord =>
      issue.kind === "story" && issue.partOf === epicId,
  );
  const byId = issuesById([...issues]);
  const storyIds = new Set(stories.map((story) => story.id));
  const childrenOf = new Map<string, StoryRecord[]>();
  const roots: StoryRecord[] = [];

  for (const story of stories) {
    const parent = nestParentOf(story, byId);
    if (parent && storyIds.has(parent)) {
      const bucket = childrenOf.get(parent) ?? [];
      bucket.push(story);
      childrenOf.set(parent, bucket);
    } else {
      roots.push(story);
    }
  }

  const ordered: EpicRailStory[] = [];
  const visit = (story: StoryRecord, depth: number): void => {
    ordered.push({ story, depth });
    for (const child of orderSiblings(childrenOf.get(story.id) ?? [])) {
      visit(child as StoryRecord, depth + 1);
    }
  };
  for (const root of orderSiblings(roots)) {
    visit(root as StoryRecord, 0);
  }
  return ordered;
}

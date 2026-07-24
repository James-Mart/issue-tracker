import { parseIssue, type Issue, type IssuePatch } from "../schemas.js";
import {
  nextSiblingOrder,
  siblingGroupKey,
  stackedOnSubtree,
} from "../order.js";
import {
  commitIssueBatch,
  readAll,
  serialize,
  type IssueWrite,
} from "./issues.js";
import { checkIntegrity } from "./integrity.js";
import { IssueError } from "./errors.js";
import { mergeIssue } from "./merge.js";

export interface MoveStoryResult {
  /** Story ids in the moved stack (dragged root first, then descendants). */
  moved: string[];
}

type Story = Extract<Issue, { kind: "story" }>;

function asStory(issue: Issue, label: string): Story {
  if (issue.kind !== "story") {
    throw new IssueError(
      "validation",
      `${label} must be a story, not a ${issue.kind}`,
    );
  }
  return issue;
}

function requireIssue(issues: Issue[], id: string): Issue {
  const issue = issues.find((i) => i.id === id);
  if (!issue) {
    throw new IssueError("not_found", `unknown issue "${id}"`);
  }
  return issue;
}

/**
 * Atomically reparent and/or restack a Story together with every transitive
 * `stackedOn` descendant, validated once via `checkIntegrity` and written with
 * a single `commitIssueBatch`.
 *
 * - Target Story → restack onto it (reparent the stack into the target's
 *   `partOf` parent when that parent differs).
 * - Target Epic or Project → reparent the stack into that container; clears the
 *   root's `stackedOn` (unstack when the container is already the current one).
 */
export function moveStory(
  id: string,
  targetId: string,
): Promise<MoveStoryResult> {
  return serialize(() => {
    const { issues } = readAll();
    const source = asStory(requireIssue(issues, id), "move-story source");

    const target = requireIssue(issues, targetId);
    if (
      target.kind !== "story" &&
      target.kind !== "epic" &&
      target.kind !== "project"
    ) {
      throw new IssueError(
        "validation",
        `move-story target must be a story, epic, or project, not a ${target.kind}`,
      );
    }

    const stories = issues.filter((i): i is Story => i.kind === "story");
    const stack = stackedOnSubtree(stories, source.id);
    const moved = stack.map((s) => s.id);
    const stackSet = new Set(moved);

    let destPartOf: string;
    let rootStackedOn: string | null | undefined;

    if (target.kind === "story") {
      if (stackSet.has(targetId)) {
        throw new IssueError(
          "validation",
          `move-story would create a stackedOn cycle (target "${targetId}" is in the moved stack)`,
        );
      }
      destPartOf = target.partOf;
      rootStackedOn = targetId;
    } else {
      destPartOf = targetId;
      rootStackedOn = null;
    }

    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const now = new Date().toISOString();
    const prospective = new Map(byId);
    const writes: IssueWrite[] = [];

    // Root is first in `moved` (stackedOnSubtree / stackedStoryOrder), so
    // order re-append sees the destination sibling group correctly.
    for (const storyId of moved) {
      const existing = asStory(
        byId.get(storyId)!,
        `stack member "${storyId}"`,
      );
      const patch: IssuePatch = { partOf: destPartOf };
      if (storyId === source.id) {
        patch.stackedOn = rootStackedOn;
      }

      const parsed = parseIssue(mergeIssue(existing, patch));
      if (!parsed.ok) throw new IssueError("validation", parsed.message);
      const story = asStory(parsed.issue, `updated "${storyId}"`);

      // Only the dragged root can land in a foreign sibling group; re-append
      // its order there (same rule as a single-story `update`). Descendants
      // keep relative order — their sibling buckets move as a unit.
      if (
        storyId === source.id &&
        siblingGroupKey(story, prospective) !==
          siblingGroupKey(existing, prospective)
      ) {
        story.order = nextSiblingOrder(
          [...prospective.values()],
          "story",
          story.partOf,
          story.stackedOn,
          source.id,
        );
      }

      const unchanged =
        story.partOf === existing.partOf &&
        story.stackedOn === existing.stackedOn &&
        story.order === existing.order;
      if (unchanged) continue;

      story.updatedAt = now;
      prospective.set(storyId, story);
      writes.push({ issue: story });
    }

    if (writes.length === 0) {
      return { moved };
    }

    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((p) => p.message).join("; "),
      );
    }

    commitIssueBatch(writes, []);
    return { moved };
  });
}

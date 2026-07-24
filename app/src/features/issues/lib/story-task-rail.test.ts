import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { storyTasksForRail, taskRailNodeState } from "./story-task-rail";

const t0 = "2026-07-01T00:00:00.000Z";

function task(
  id: string,
  partOf: string,
  status: Extract<IssueRecord, { kind: "task" }>["status"],
  extras: Partial<Extract<IssueRecord, { kind: "task" }>> = {},
): Extract<IssueRecord, { kind: "task" }> {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    order: extras.order ?? 0,
    createdAt: t0,
    updatedAt: t0,
    status,
    ...extras,
  };
}

describe("taskRailNodeState", () => {
  it("maps in-progress and fixing to in-flight", () => {
    expect(taskRailNodeState(task("a", "s", "in-progress"))).toBe("in-flight");
    expect(taskRailNodeState(task("b", "s", "fixing"))).toBe("in-flight");
  });

  it("maps done to merged whether or not commitSha is set", () => {
    expect(
      taskRailNodeState(
        task("a", "s", "done", {
          commitSha: "deadbeef00000000000000000000000000000000",
        }),
      ),
    ).toBe("merged");
    expect(taskRailNodeState(task("b", "s", "done", { noDiff: true }))).toBe(
      "merged",
    );
  });

  it("maps todo to ready", () => {
    expect(taskRailNodeState(task("a", "s", "todo"))).toBe("ready");
  });
});

describe("storyTasksForRail", () => {
  it("returns only this Story's tasks in sequence order", () => {
    const issues: IssueRecord[] = [
      task("c", "story-a", "todo", { order: 2 }),
      task("a", "story-a", "done", { order: 0 }),
      task("b", "story-a", "in-progress", { order: 1 }),
      task("other", "story-b", "todo", { order: 0 }),
    ];
    expect(storyTasksForRail("story-a", issues).map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("excludes sibling Stories", () => {
    const issues: IssueRecord[] = [
      {
        id: "sibling",
        kind: "story",
        title: "Sibling",
        partOf: "epic",
        order: 1,
        createdAt: t0,
        updatedAt: t0,
        branchName: "sibling",
        merged: false,
        needsAttention: false,
        attentionReason: null,
        archived: false,
        stackedOn: "story-a",
      },
      task("only", "story-a", "todo"),
    ];
    expect(storyTasksForRail("story-a", issues).map((t) => t.id)).toEqual([
      "only",
    ]);
  });
});

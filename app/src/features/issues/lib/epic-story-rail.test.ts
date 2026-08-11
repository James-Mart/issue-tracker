import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { epicStoriesForRail, storyRailNodeState } from "./epic-story-rail";

const t0 = "2026-07-01T00:00:00.000Z";

function story(
  id: string,
  partOf: string,
  extras: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
): Extract<IssueRecord, { kind: "story" }> {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: extras.order ?? 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...extras,
  };
}

function task(
  id: string,
  partOf: string,
  status: Extract<IssueRecord, { kind: "task" }>["status"],
): Extract<IssueRecord, { kind: "task" }> {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    status,
  };
}

describe("storyRailNodeState", () => {
  it("delegates to shared issue rail state", () => {
    expect(
      storyRailNodeState(story("s", "e", { merged: true }), {
        blocked: false,
        storyStatus: "merged",
      }),
    ).toBe("merged");
    expect(
      storyRailNodeState(story("s", "e"), {
        blocked: true,
        storyStatus: "todo",
      }),
    ).toBe("blocked");
  });

  it("maps an in-flight child task to in-flight", () => {
    const issues: IssueRecord[] = [
      story("s", "e"),
      task("t", "s", "in-progress"),
    ];
    expect(
      storyRailNodeState(story("s", "e"), {
        blocked: false,
        storyStatus: "not-started",
      }, issues),
    ).toBe("in-flight");
  });
});

describe("epicStoriesForRail", () => {
  it("returns only this Epic's stories in sequence order at depth 0", () => {
    const issues: IssueRecord[] = [
      story("c", "epic-a", { order: 2 }),
      story("a", "epic-a", { order: 0 }),
      story("b", "epic-a", { order: 1 }),
      story("other", "epic-b", { order: 0 }),
    ];
    expect(
      epicStoriesForRail("epic-a", issues).map(({ story, depth }) => [
        story.id,
        depth,
      ]),
    ).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 0],
    ]);
  });

  it("excludes sibling Epics' stories", () => {
    const issues: IssueRecord[] = [
      story("sibling", "epic-b", { order: 0 }),
      story("only", "epic-a", { order: 0 }),
    ];
    expect(
      epicStoriesForRail("epic-a", issues).map(({ story }) => story.id),
    ).toEqual(["only"]);
  });

  it("nests stacked Stories under stackedOn with Structure order and depths", () => {
    // Epic roots a (order 0), c (order 1). Stack on a: mid (0) → deep, then mid-b (1).
    const issues: IssueRecord[] = [
      story("deep", "epic-a", { order: 0, stackedOn: "mid" }),
      story("mid-b", "epic-a", { order: 1, stackedOn: "a" }),
      story("c", "epic-a", { order: 1 }),
      story("mid", "epic-a", { order: 0, stackedOn: "a" }),
      story("a", "epic-a", { order: 0 }),
    ];
    expect(
      epicStoriesForRail("epic-a", issues).map(({ story, depth }) => [
        story.id,
        depth,
      ]),
    ).toEqual([
      ["a", 0],
      ["mid", 1],
      ["deep", 2],
      ["mid-b", 1],
      ["c", 0],
    ]);
  });
});

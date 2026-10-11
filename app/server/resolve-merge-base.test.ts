import { describe, expect, it } from "vitest";
import { resolveMergeBase } from "./resolve-merge-base";
import type { Issue } from "./schemas";

const AT = "2026-07-09T14:00:00.000Z";

function project(id: string): Issue {
  return {
    id,
    kind: "project",
    title: id,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  };
}

function epic(
  id: string,
  extra: Partial<Extract<Issue, { kind: "epic" }>> = {},
): Issue {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "p",
    order: 0,
    blockedBy: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}

function branch(
  id: string,
  extra: Partial<Extract<Issue, { kind: "story" }>> = {},
): Issue {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "e",
    order: 0,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}

function asStory(issue: Issue): Extract<Issue, { kind: "story" }> {
  if (issue.kind !== "story") throw new Error("expected story");
  return issue;
}

describe("resolveMergeBase", () => {
  it("uses an Epic's mergeBaseOverride for a first-layer Story", () => {
    const e = epic("e", { mergeBaseOverride: "feat/epic-base" });
    const story = asStory(branch("b", { partOf: "e" }));
    expect(resolveMergeBase(story, [project("p"), e, story])).toBe(
      "feat/epic-base",
    );
  });

  it("uses the parent's branchName when the parent is already named", () => {
    const parent = branch("parent", { branchName: "feat/parent" });
    const child = asStory(branch("child", { stackedOn: "parent" }));
    expect(resolveMergeBase(child, [parent, child])).toBe("feat/parent");
  });

  it("resolves a merged parent recursively (not branchName)", () => {
    const grand = branch("grand", { branchName: "feat/grand" });
    const parent = branch("parent", {
      branchName: "feat/parent",
      stackedOn: "grand",
      merged: true,
    });
    const child = asStory(branch("child", { stackedOn: "parent" }));
    expect(resolveMergeBase(child, [grand, parent, child])).toBe("feat/grand");
  });
});

import { describe, expect, it } from "vitest";
import { resolveMergeBase } from "./resolve-merge-base";
import type { Issue } from "./schemas";

const AT = "2026-07-09T14:00:00.000Z";

function project(
  id: string,
  extra: Partial<Extract<Issue, { kind: "project" }>> = {},
): Issue {
  return {
    id,
    kind: "project",
    title: id,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
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
    needsAttention: false,
    attentionReason: null,
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
  it("defaults a root Branch to main", () => {
    const story = asStory(branch("b", { partOf: "p" }));
    expect(resolveMergeBase(story, [project("p"), story])).toBe("main");
  });

  it("uses a custom trunk for a root Branch", () => {
    const story = asStory(branch("b", { partOf: "p" }));
    expect(
      resolveMergeBase(story, [project("p", { trunk: "develop" }), story], undefined, "develop"),
    ).toBe("develop");
  });

  it("uses a root Story's mergeBaseOverride over trunk", () => {
    const story = asStory(
      branch("b", { partOf: "p", mergeBaseOverride: "feat/existing" }),
    );
    expect(resolveMergeBase(story, [project("p"), story])).toBe("feat/existing");
  });

  it("uses an Epic's mergeBaseOverride for a first-layer Story", () => {
    const e = epic("e", { mergeBaseOverride: "feat/epic-base" });
    const story = asStory(branch("b", { partOf: "e" }));
    expect(resolveMergeBase(story, [project("p"), e, story])).toBe(
      "feat/epic-base",
    );
  });

  it("ignores a first-layer Story's own mergeBaseOverride in favor of the Epic", () => {
    const e = epic("e", { mergeBaseOverride: "feat/epic-base" });
    const story = asStory(
      branch("b", { partOf: "e", mergeBaseOverride: "feat/ignored" }),
    );
    expect(resolveMergeBase(story, [project("p"), e, story])).toBe(
      "feat/epic-base",
    );
  });

  it("uses the parent's branchName when the parent is already named", () => {
    const parent = branch("parent", { branchName: "feat/parent" });
    const child = asStory(branch("child", { stackedOn: "parent" }));
    expect(resolveMergeBase(child, [parent, child])).toBe("feat/parent");
  });

  it("leaves a stacked child unset when the parent has no branchName", () => {
    const parent = branch("parent");
    const child = asStory(branch("child", { stackedOn: "parent" }));
    expect(resolveMergeBase(child, [parent, child])).toBeUndefined();
  });

  it("keeps stacked derivation when an Epic override is set", () => {
    const e = epic("e", { mergeBaseOverride: "feat/epic-base" });
    const parent = branch("parent", { branchName: "feat/parent" });
    const child = asStory(branch("child", { stackedOn: "parent" }));
    expect(resolveMergeBase(child, [project("p"), e, parent, child])).toBe(
      "feat/parent",
    );
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

  it("resolves a merged root parent to main", () => {
    const parent = branch("parent", {
      partOf: "p",
      branchName: "feat/parent",
      merged: true,
    });
    const child = asStory(branch("child", { partOf: "p", stackedOn: "parent" }));
    expect(resolveMergeBase(child, [project("p"), parent, child])).toBe("main");
  });

  it("resolves a merged root parent through its mergeBaseOverride", () => {
    const parent = branch("parent", {
      partOf: "p",
      branchName: "feat/parent",
      merged: true,
      mergeBaseOverride: "feat/existing",
    });
    const child = asStory(branch("child", { partOf: "p", stackedOn: "parent" }));
    expect(resolveMergeBase(child, [project("p"), parent, child])).toBe(
      "feat/existing",
    );
  });

  it("resolves a merged first-layer parent through the Epic override", () => {
    const e = epic("e", { mergeBaseOverride: "feat/epic-base" });
    const parent = branch("parent", {
      branchName: "feat/parent",
      merged: true,
    });
    const child = asStory(branch("child", { stackedOn: "parent" }));
    expect(resolveMergeBase(child, [project("p"), e, parent, child])).toBe(
      "feat/epic-base",
    );
  });

  it("uses branchName when the parent is unmerged", () => {
    const parent = branch("parent", {
      branchName: "feat/parent",
      merged: false,
    });
    const child = asStory(branch("child", { stackedOn: "parent" }));
    expect(resolveMergeBase(child, [parent, child])).toBe("feat/parent");
  });

  it("leaves unset when a merged parent resolves to an unnamed ancestor", () => {
    const grand = branch("grand");
    const parent = branch("parent", {
      branchName: "feat/parent",
      stackedOn: "grand",
      merged: true,
    });
    const child = asStory(branch("child", { stackedOn: "parent" }));
    expect(resolveMergeBase(child, [grand, parent, child])).toBeUndefined();
  });

  it("accepts a pre-built storiesById map", () => {
    const parent = asStory(branch("parent", { branchName: "feat/parent" }));
    const child = asStory(branch("child", { stackedOn: "parent" }));
    const storiesById = new Map([["parent", parent]]);
    expect(resolveMergeBase(child, [parent, child], storiesById)).toBe(
      "feat/parent",
    );
  });

  it("accepts a pre-built issuesById map for unstacked Epic override", () => {
    const e = epic("e", { mergeBaseOverride: "feat/epic-base" });
    const story = asStory(branch("b", { partOf: "e" }));
    const issues = [project("p"), e, story];
    const issuesById = new Map(issues.map((issue) => [issue.id, issue]));
    expect(
      resolveMergeBase(story, [], undefined, "main", issuesById),
    ).toBe("feat/epic-base");
  });
});

import { describe, expect, it } from "vitest";
import { EPIC_BASE } from "./fields";
import { resolveMergeBase } from "./resolve-merge-base";
import type { Issue } from "./schemas";

const AT = "2026-07-09T14:00:00.000Z";

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

describe("resolveMergeBase", () => {
  it("defaults a root Branch to main", () => {
    expect(resolveMergeBase(undefined, [])).toBe(EPIC_BASE);
  });

  it("uses the parent's branchName when the parent is already named", () => {
    const issues = [branch("parent", { branchName: "feat/parent" })];
    expect(resolveMergeBase("parent", issues)).toBe("feat/parent");
  });

  it("leaves a stacked child unset when the parent has no branchName", () => {
    const issues = [branch("parent")];
    expect(resolveMergeBase("parent", issues)).toBeUndefined();
  });

  it("resolves a merged parent recursively (not branchName)", () => {
    const issues = [
      branch("grand", { branchName: "feat/grand" }),
      branch("parent", {
        branchName: "feat/parent",
        stackedOn: "grand",
        merged: true,
      }),
    ];
    expect(resolveMergeBase("parent", issues)).toBe("feat/grand");
  });

  it("resolves a merged root parent to main", () => {
    const issues = [
      branch("parent", {
        branchName: "feat/parent",
        merged: true,
      }),
    ];
    expect(resolveMergeBase("parent", issues)).toBe(EPIC_BASE);
  });

  it("uses branchName when the parent is unmerged", () => {
    const issues = [
      branch("parent", {
        branchName: "feat/parent",
        merged: false,
      }),
    ];
    expect(resolveMergeBase("parent", issues)).toBe("feat/parent");
  });

  it("leaves unset when a merged parent resolves to an unnamed ancestor", () => {
    const issues = [
      branch("grand"),
      branch("parent", {
        branchName: "feat/parent",
        stackedOn: "grand",
        merged: true,
      }),
    ];
    expect(resolveMergeBase("parent", issues)).toBeUndefined();
  });

  it("accepts a pre-built storiesById map", () => {
    const parent = branch("parent", { branchName: "feat/parent" });
    const storiesById = new Map([["parent", parent]]);
    expect(resolveMergeBase("parent", [], storiesById)).toBe("feat/parent");
  });
});

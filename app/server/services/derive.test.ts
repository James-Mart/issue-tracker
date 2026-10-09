import { describe, expect, it } from "vitest";
import { derive } from "./derive";
import type { Issue } from "../schemas";

let clock = 0;
function nextAt(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 6, 9, 14, 0, clock)).toISOString();
}

const epic = (
  id: string,
  partOf = "p",
  order = 0,
  extra: Partial<Extract<Issue, { kind: "epic" }>> = {},
): Issue => ({
  id,
  kind: "epic",
  title: id,
  partOf,
  order,
  blockedBy: [],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: nextAt(),
  updatedAt: nextAt(),
  ...extra,
});

const branch = (
  id: string,
  partOf: string,
  extra: Partial<Extract<Issue, { kind: "story" }>> = {},
  order = 0,
): Issue => ({
  id,
  kind: "story",
  title: id,
  partOf,
  order,
  merged: false,
  reviewedTasks: [],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: nextAt(),
  updatedAt: nextAt(),
  ...extra,
});

const commit = (
  id: string,
  partOf: string,
  extra: Partial<Extract<Issue, { kind: "task" }>> = {},
  order = 0,
): Issue => ({
  id,
  kind: "task",
  title: id,
  partOf,
  order,
  status: "todo",
  commits: [],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: nextAt(),
  updatedAt: nextAt(),
  ...extra,
});

const project = (
  id: string,
  order = 0,
  extra: Partial<Extract<Issue, { kind: "project" }>> = {},
): Issue => ({
  id,
  kind: "project",
  title: id,
  trunk: "main",
  mergePolicy: "manual",
  maxImplementingRuns: 1,
  order,
  createdAt: nextAt(),
  updatedAt: nextAt(),
  ...extra,
});

describe("derive - commit blocked", () => {
  it("blocks a todo commit when an earlier sibling is not done", () => {
    const issues = [
      project("p"),
      epic("e"),
      branch("b", "e", { branchName: "feat/b" }),
      commit("c1", "b", {}, 0),
      commit("c2", "b", {}, 1),
    ];
    const { byId } = derive(issues);
    expect(byId.c1.blocked).toBe(false);
    expect(byId.c2.blocked).toBe(true);
  });
});

describe("derive - branch status", () => {
  it("is pr-open when all child commits are done and a prUrl is set", () => {
    const issues = [
      epic("e"),
      branch("b", "e", { branchName: "feat/b", prUrl: "http://pr/1" }),
      commit("c1", "b", { status: "done", commits: ["a"] }),
      commit("c2", "b", { status: "done", commits: ["b"] }),
    ];
    expect(derive(issues).byId.b.storyStatus).toBe("pr-open");
  });
});

describe("derive - epic rollup", () => {
  it("is done when every descendant branch is merged", () => {
    const issues = [
      epic("e"),
      branch("b1", "e", { merged: true, branchName: "x" }),
      branch("b2", "e", { merged: true, branchName: "y" }),
    ];
    expect(derive(issues).byId.e.epicStatus).toBe("done");
  });
});

describe("derive - review coverage", () => {
  it("is false when a task is injected after the review", () => {
    const issues = [
      epic("e"),
      branch("b", "e", {
        branchName: "feat/b",
        review: "passed",
        reviewedTasks: ["c1"],
      }),
      commit("c1", "b", { status: "done", commits: ["a"] }, 0),
      commit("c2", "b", { status: "done", commits: ["b"] }, 1),
    ];
    expect(derive(issues).byId.b.reviewCurrent).toBe(false);
  });
});

describe("derive - effective mergePolicy", () => {
  it("inherits parent Story effective policy down a stack", () => {
    const issues = [
      project("p", 0, { mergePolicy: "manual" }),
      epic("e"),
      branch("base", "e", { branchName: "feat/base", mergePolicy: "fast-forward" }),
      branch("child", "e", { stackedOn: "base" }),
    ];
    const { byId } = derive(issues);
    expect(byId.base.mergePolicy).toBe("fast-forward");
    expect(byId.child.mergePolicy).toBe("fast-forward");
  });
});

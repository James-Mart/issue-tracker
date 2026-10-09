import { describe, expect, it } from "vitest";
import { checkIntegrity, problemsFor } from "./integrity";
import type { Issue } from "../schemas";

const AT = "2026-07-09T14:00:00.000Z";

const epic = (
  id: string,
  partOf = "root",
  extra: Partial<Extract<Issue, { kind: "epic" }>> = {},
): Issue => ({
  id,
  kind: "epic",
  title: id,
  partOf,
  order: 0,
  blockedBy: [],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const branch = (
  id: string,
  partOf: string,
  extra: Partial<Extract<Issue, { kind: "story" }>> = {},
): Issue => ({
  id,
  kind: "story",
  title: id,
  partOf,
  order: 0,
  merged: false,
  reviewedTasks: [],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const commit = (
  id: string,
  partOf: string,
  extra: Partial<Extract<Issue, { kind: "task" }>> = {},
): Issue => ({
  id,
  kind: "task",
  title: id,
  partOf,
  order: 0,
  status: "todo",
  commits: [],
  needsAttention: false,
  attentionReason: null,
  archived: false,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

describe("checkIntegrity", () => {
  it("flags a dangling partOf", () => {
    const problems = checkIntegrity([commit("c1", "ghost")]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ id: "c1" });
    expect(problems[0].message).toContain("unknown issue");
  });
});

describe("checkIntegrity - cycles", () => {
  it("flags a two-branch stackedOn cycle on both members", () => {
    const problems = checkIntegrity([
      epic("e1"),
      branch("a", "e1", { stackedOn: "b" }),
      branch("b", "e1", { stackedOn: "a" }),
    ]);
    const cycleIds = problems
      .filter((p) => /cycle/i.test(p.message))
      .map((p) => p.id)
      .sort();
    expect(cycleIds).toEqual(["a", "b"]);
  });
});

describe("validate-at-write (problemsFor against a prospective state)", () => {
  it("rejects a write that would close a stackedOn cycle", () => {
    const prospective = [
      epic("e1"),
      branch("a", "e1", { stackedOn: "b" }),
      branch("b", "e1", { stackedOn: "a" }),
    ];
    expect(problemsFor("b", prospective).length).toBeGreaterThan(0);
  });
});

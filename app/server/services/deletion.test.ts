import { describe, expect, it } from "vitest";
import { planDeletion } from "./deletion";
import type { Issue } from "../schemas";

const AT = "2026-07-09T14:00:00.000Z";

const project = (id: string): Issue => ({
  id,
  kind: "project",
  title: id,
  trunk: "main",
  mergePolicy: "manual",
  maxImplementingRuns: 1,
  order: 0,
  createdAt: AT,
  updatedAt: AT,
});

const epic = (
  id: string,
  partOf = "p",
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

const commit = (id: string, partOf: string, extra: Partial<Extract<Issue, { kind: "task" }>> = {}): Issue => ({
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

describe("planDeletion - containment cascade", () => {
  it("deletes a project, its epics, branches, and their commits transitively", () => {
    const plan = planDeletion(
      [
        project("p"),
        epic("e", "p"),
        branch("b", "e"),
        commit("c", "b"),
      ],
      "p",
    );
    expect([...plan.deleteIds].sort()).toEqual(["b", "c", "e", "p"]);
    expect(plan.repoint).toEqual([]);
    expect(plan.unblock).toEqual([]);
  });
});

describe("planDeletion - stackedOn splice", () => {
  it("splices a mid-stack branch to its grandparent fork point", () => {
    const plan = planDeletion(
      [
        epic("e"),
        branch("a", "e"),
        branch("b", "e", { stackedOn: "a" }),
        branch("c", "e", { stackedOn: "b" }),
      ],
      "b",
    );
    expect(plan.deleteIds).toEqual(["b"]);
    expect(plan.repoint).toEqual([{ id: "c", to: "a" }]);
  });
});

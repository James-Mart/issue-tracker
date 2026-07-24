import { describe, expect, it } from "vitest";
import { planDeletion } from "./deletion";
import type { Issue } from "../schemas";

const AT = "2026-07-09T14:00:00.000Z";

const project = (id: string): Issue => ({
  id,
  kind: "project",
  title: id,
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
  needsAttention: false,
  attentionReason: null,
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const commit = (id: string, partOf: string): Issue => ({
  id,
  kind: "task",
  title: id,
  partOf,
  order: 0,
  status: "todo",
  needsAttention: false,
  attentionReason: null,
  createdAt: AT,
  updatedAt: AT,
});

describe("planDeletion - containment cascade", () => {
  it("deletes only the commit itself", () => {
    const plan = planDeletion(
      [epic("e"), branch("b", "e"), commit("c", "b")],
      "c",
    );
    expect(plan.deleteIds).toEqual(["c"]);
    expect(plan.repoint).toEqual([]);
    expect(plan.unblock).toEqual([]);
  });

  it("deletes a branch and its commits", () => {
    const plan = planDeletion(
      [epic("e"), branch("b", "e"), commit("c1", "b"), commit("c2", "b")],
      "b",
    );
    expect([...plan.deleteIds].sort()).toEqual(["b", "c1", "c2"]);
  });

  it("deletes an epic, its branches, and their commits transitively", () => {
    const plan = planDeletion(
      [
        epic("e"),
        branch("b1", "e"),
        branch("b2", "e", { stackedOn: "b1" }),
        commit("c1", "b1"),
        commit("c2", "b2"),
      ],
      "e",
    );
    expect([...plan.deleteIds].sort()).toEqual(["b1", "b2", "c1", "c2", "e"]);
    expect(plan.repoint).toEqual([]);
  });

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

  it("deletes project-level stories with the project, not with an unrelated epic", () => {
    const issues = [
      project("p"),
      epic("e", "p"),
      branch("under-epic", "e"),
      branch("under-project", "p"),
      commit("c-epic", "under-epic"),
      commit("c-project", "under-project"),
    ];
    const deleteProject = planDeletion(issues, "p");
    expect([...deleteProject.deleteIds].sort()).toEqual([
      "c-epic",
      "c-project",
      "e",
      "p",
      "under-epic",
      "under-project",
    ]);

    const deleteEpic = planDeletion(issues, "e");
    expect([...deleteEpic.deleteIds].sort()).toEqual([
      "c-epic",
      "e",
      "under-epic",
    ]);
    expect(deleteEpic.deleteIds).not.toContain("under-project");
    expect(deleteEpic.deleteIds).not.toContain("c-project");
  });

  it("returns an empty plan for an unknown id", () => {
    expect(planDeletion([epic("e")], "ghost")).toEqual({
      deleteIds: [],
      repoint: [],
      unblock: [],
    });
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

  it("splices to main (undefined) when the deleted branch forked main", () => {
    const plan = planDeletion(
      [epic("e"), branch("a", "e"), branch("b", "e", { stackedOn: "a" })],
      "a",
    );
    expect(plan.repoint).toEqual([{ id: "b", to: undefined }]);
  });
});

describe("planDeletion - blockedBy drop", () => {
  it("drops the deleted epic from a dependent epic's blockedBy", () => {
    const plan = planDeletion(
      [
        project("p"),
        epic("a", "p"),
        epic("b", "p"),
        epic("d", "p", { blockedBy: ["a", "b"] }),
      ],
      "a",
    );
    expect(plan.unblock).toEqual([{ id: "d", blockedBy: ["b"] }]);
  });

  it("drops a blockedBy edge when the whole blocking Epic (with its branches) is deleted", () => {
    const plan = planDeletion(
      [
        project("p"),
        epic("e1", "p"),
        branch("a", "e1"),
        epic("e2", "p", { blockedBy: ["e1"] }),
      ],
      "e1",
    );
    expect([...plan.deleteIds].sort()).toEqual(["a", "e1"]);
    expect(plan.unblock).toEqual([{ id: "e2", blockedBy: [] }]);
  });

  it("leaves a dependent epic's blockedBy untouched when an unrelated epic is deleted", () => {
    const plan = planDeletion(
      [
        project("p"),
        epic("a", "p"),
        epic("b", "p"),
        epic("d", "p", { blockedBy: ["a"] }),
      ],
      "b",
    );
    expect(plan.unblock).toEqual([]);
  });
});

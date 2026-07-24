import { describe, expect, it } from "vitest";
import { derive } from "./derive";
import { EPIC_BASE } from "./merge-base";
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
  needsAttention: false,
  attentionReason: null,
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
  needsAttention: false,
  attentionReason: null,
  createdAt: nextAt(),
  updatedAt: nextAt(),
  ...extra,
});

const project = (id: string, order = 0): Issue => ({
  id,
  kind: "project",
  title: id,
  order,
  createdAt: nextAt(),
  updatedAt: nextAt(),
});

describe("derive - commit blocked", () => {
  it("does not block a todo commit when its branch has a name and earlier siblings are done", () => {
    const issues = [
      project("p"),
      epic("e"),
      branch("b", "e", { branchName: "feat/b" }),
      commit("c1", "b", { status: "done", commitSha: "aaa" }, 0),
      commit("c2", "b", {}, 1),
    ];
    const { byId } = derive(issues);
    expect(byId.c2.blocked).toBe(false);
  });

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

  it("blocks a todo commit when its branch has no branchName", () => {
    const issues = [epic("e"), branch("b", "e"), commit("c1", "b")];
    const { byId } = derive(issues);
    expect(byId.c1.blocked).toBe(true);
  });

  it("does not block in-progress and done commits", () => {
    const issues = [
      epic("e"),
      branch("b", "e", { branchName: "feat/b" }),
      commit("c1", "b", { status: "in-progress" }),
      commit("c2", "b", { status: "done", commitSha: "z" }),
    ];
    const { byId } = derive(issues);
    expect(byId.c1.blocked).toBe(false);
    expect(byId.c2.blocked).toBe(false);
  });

  it("blocks a todo commit when its branch is merged", () => {
    const issues = [
      epic("e"),
      branch("b", "e", { branchName: "feat/b", merged: true }),
      commit("c1", "b"),
    ];
    const { byId } = derive(issues);
    expect(byId.c1.blocked).toBe(true);
  });
});

describe("derive - branch mergeBase resolution", () => {
  it("derives mergeBase from a named parent", () => {
    const issues = [
      epic("e"),
      branch("base", "e", { branchName: "feat/base" }),
      branch("b", "e", { stackedOn: "base" }),
    ];
    const { byId } = derive(issues);
    expect(byId.b.mergeBase).toBe("feat/base");
  });

  it("surfaces a root Branch's derived mergeBase as main", () => {
    const issues = [epic("e"), branch("b", "e")];
    expect(derive(issues).byId.b.mergeBase).toBe(EPIC_BASE);
  });

  it("omits mergeBase when stacked on an unnamed parent", () => {
    const issues = [
      epic("e"),
      branch("base", "e"),
      branch("b", "e", { stackedOn: "base" }),
    ];
    expect(derive(issues).byId.b.mergeBase).toBeUndefined();
  });

  it("derives mergeBase from a merged parent's resolve", () => {
    const issues = [
      epic("e"),
      branch("parent", "e", { branchName: "feat/parent", merged: true }),
      branch("b", "e", { stackedOn: "parent" }),
    ];
    expect(derive(issues).byId.b.mergeBase).toBe(EPIC_BASE);
  });
});

describe("derive - branch status", () => {
  it("is merged when merged", () => {
    const issues = [epic("e"), branch("b", "e", { merged: true, branchName: "x" })];
    expect(derive(issues).byId.b.storyStatus).toBe("merged");
  });

  it("is pr-open when all child commits are done and a prUrl is set", () => {
    const issues = [
      epic("e"),
      branch("b", "e", { branchName: "feat/b", prUrl: "http://pr/1" }),
      commit("c1", "b", { status: "done", commitSha: "a" }),
      commit("c2", "b", { status: "done", commitSha: "b" }),
    ];
    expect(derive(issues).byId.b.storyStatus).toBe("pr-open");
  });

  it("is in-progress when a branchName exists but not all commits are done", () => {
    const issues = [
      epic("e"),
      branch("b", "e", { branchName: "feat/b", prUrl: "http://pr/1" }),
      commit("c1", "b", { status: "done", commitSha: "a" }),
      commit("c2", "b"),
    ];
    expect(derive(issues).byId.b.storyStatus).toBe("in-progress");
  });

  it("is not-started when there is no branchName", () => {
    const issues = [epic("e"), branch("b", "e")];
    expect(derive(issues).byId.b.storyStatus).toBe("not-started");
  });

  it("is not pr-open when the branch has a prUrl but zero commits", () => {
    const issues = [
      epic("e"),
      branch("b", "e", { branchName: "feat/b", prUrl: "http://pr/1" }),
    ];
    expect(derive(issues).byId.b.storyStatus).toBe("in-progress");
  });
});

describe("derive - branch start gating", () => {
  it("is not blocked when it has no stackedOn (a root branch forks main)", () => {
    const issues = [epic("e"), branch("b", "e")];
    const d = derive(issues).byId.b;
    expect(d.blocked).toBe(false);
  });

  it("is blocked when its stackedOn base has no tip yet (no branchName)", () => {
    const issues = [
      epic("e"),
      branch("base", "e"),
      branch("b", "e", { stackedOn: "base" }),
    ];
    const d = derive(issues).byId.b;
    expect(d.blocked).toBe(true);
  });

  it("is blocked when its parent's commits are not all done", () => {
    const issues = [
      epic("e"),
      branch("base", "e", { branchName: "feat/base" }),
      commit("bc", "base", {}, 0),
      branch("b", "e", { stackedOn: "base" }),
    ];
    const d = derive(issues).byId.b;
    expect(d.blocked).toBe(true);
  });

  it("is not blocked when its parent has a tip and all its commits are done (no merge gate)", () => {
    const issues = [
      epic("e"),
      branch("base", "e", { branchName: "feat/base" }),
      commit("bc", "base", { status: "done", commitSha: "aaa" }, 0),
      branch("b", "e", { stackedOn: "base" }),
    ];
    const d = derive(issues).byId.b;
    expect(d.blocked).toBe(false);
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

  it("is in-progress when a branch has started", () => {
    const issues = [
      epic("e"),
      branch("b1", "e", { branchName: "x" }),
      branch("b2", "e"),
    ];
    expect(derive(issues).byId.e.epicStatus).toBe("in-progress");
  });

  it("is todo when no branch has started", () => {
    const issues = [epic("e"), branch("b1", "e"), branch("b2", "e")];
    expect(derive(issues).byId.e.epicStatus).toBe("todo");
  });

  it("is todo for an empty epic", () => {
    expect(derive([epic("e")]).byId.e.epicStatus).toBe("todo");
  });

  it("ignores stored retro when computing epicStatus", () => {
    const issues = [epic("e", "p", 0, { retro: "done" })];
    expect(derive(issues).byId.e.epicStatus).toBe("todo");
  });
});

describe("derive - epic blocked gating", () => {
  it("marks an epic blocked while a blockedBy epic is not done", () => {
    const issues = [
      project("p"),
      epic("dep", "p", 0),
      branch("d", "dep"),
      epic("gated", "p", 1, { blockedBy: ["dep"] }),
      branch("g", "gated"),
    ];
    const { byId } = derive(issues);
    expect(byId.dep.blocked).toBe(false);
    expect(byId.gated.blocked).toBe(true);
  });

  it("does not block a dependent epic once every blocker epic is done", () => {
    const issues = [
      project("p"),
      epic("dep", "p", 0),
      branch("d", "dep", { merged: true, branchName: "feat/d" }),
      epic("gated", "p", 1, { blockedBy: ["dep"] }),
      branch("g", "gated"),
    ];
    const { byId } = derive(issues);
    expect(byId.dep.epicStatus).toBe("done");
    expect(byId.gated.blocked).toBe(false);
  });
});

describe("derive - problems", () => {
  it("passes integrity problems through (cycles, dangling, kind)", () => {
    const issues = [
      epic("e"),
      branch("a", "e", { stackedOn: "b" }),
      branch("b", "e", { stackedOn: "a" }),
      commit("c", "e"),
    ];
    const problems = derive(issues).problems;
    expect(problems.filter((p) => /cycle/i.test(p.message)).map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(problems.some((p) => p.id === "c" && /must be a story/.test(p.message))).toBe(true);
  });
});

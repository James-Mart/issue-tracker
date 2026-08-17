import { describe, expect, it } from "vitest";
import { MERGE_POLICY_RANK } from "../fields";
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

const project = (
  id: string,
  order = 0,
  extra: Partial<Extract<Issue, { kind: "project" }>> = {},
): Issue => ({
  id,
  kind: "project",
  title: id,
  order,
  createdAt: nextAt(),
  updatedAt: nextAt(),
  ...extra,
});

const idea = (
  id: string,
  partOf = "p",
  order = 0,
  extra: Partial<Extract<Issue, { kind: "idea" }>> = {},
): Issue => ({
  id,
  kind: "idea",
  title: id,
  partOf,
  order,
  createdAt: nextAt(),
  updatedAt: nextAt(),
  ...extra,
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
    const issues = [project("p"), epic("e"), branch("b", "e")];
    expect(derive(issues).byId.b.mergeBase).toBe("main");
  });

  it("surfaces a root Branch's derived mergeBase from the project trunk", () => {
    const issues = [
      project("p", 0, { trunk: "develop" }),
      epic("e"),
      branch("b", "e"),
    ];
    expect(derive(issues).byId.b.mergeBase).toBe("develop");
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
      project("p"),
      epic("e"),
      branch("parent", "e", { branchName: "feat/parent", merged: true }),
      branch("b", "e", { stackedOn: "parent" }),
    ];
    expect(derive(issues).byId.b.mergeBase).toBe("main");
  });

  it("derives mergeBase from a merged parent using the project trunk", () => {
    const issues = [
      project("p", 0, { trunk: "develop" }),
      epic("e"),
      branch("parent", "e", { branchName: "feat/parent", merged: true }),
      branch("b", "e", { stackedOn: "parent" }),
    ];
    expect(derive(issues).byId.b.mergeBase).toBe("develop");
  });

  it("derives mergeBase from a root Story's mergeBaseOverride", () => {
    const issues = [
      project("p"),
      branch("b", "p", { mergeBaseOverride: "feat/existing" }),
    ];
    expect(derive(issues).byId.b.mergeBase).toBe("feat/existing");
  });

  it("derives first-layer Epic Story mergeBase from the Epic override", () => {
    const issues = [
      project("p"),
      epic("e", "p", 0, { mergeBaseOverride: "feat/epic-base" }),
      branch("b", "e"),
    ];
    expect(derive(issues).byId.b.mergeBase).toBe("feat/epic-base");
  });

  it("keeps stacked mergeBase on the parent branch when an Epic override is set", () => {
    const issues = [
      project("p"),
      epic("e", "p", 0, { mergeBaseOverride: "feat/epic-base" }),
      branch("base", "e", { branchName: "feat/base" }),
      branch("b", "e", { stackedOn: "base" }),
    ];
    expect(derive(issues).byId.b.mergeBase).toBe("feat/base");
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
  it("is not blocked when it has no stackedOn (a root branch forks project trunk)", () => {
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

describe("derive - review coverage", () => {
  it("leaves reviewCurrent false when no review is recorded", () => {
    const issues = [
      epic("e"),
      branch("b", "e", { branchName: "feat/b" }),
      commit("c1", "b", { status: "done", commitSha: "a" }),
    ];
    expect(derive(issues).byId.b.reviewCurrent).toBe(false);
  });

  it("is true when review covers every done task", () => {
    const issues = [
      epic("e"),
      branch("b", "e", {
        branchName: "feat/b",
        review: "passed",
        reviewedTasks: ["c1", "c2"],
      }),
      commit("c1", "b", { status: "done", commitSha: "a" }, 0),
      commit("c2", "b", { status: "done", commitSha: "b" }, 1),
    ];
    expect(derive(issues).byId.b.reviewCurrent).toBe(true);
  });

  it("is false when a task is injected after the review", () => {
    const issues = [
      epic("e"),
      branch("b", "e", {
        branchName: "feat/b",
        review: "passed",
        reviewedTasks: ["c1"],
      }),
      commit("c1", "b", { status: "done", commitSha: "a" }, 0),
      commit("c2", "b", { status: "done", commitSha: "b" }, 1),
    ];
    expect(derive(issues).byId.b.reviewCurrent).toBe(false);
  });

  it("is false when a covered task moves back off done", () => {
    const issues = [
      epic("e"),
      branch("b", "e", {
        branchName: "feat/b",
        review: "passed",
        reviewedTasks: ["c1", "c2"],
      }),
      commit("c1", "b", { status: "done", commitSha: "a" }, 0),
      commit("c2", "b", { status: "in-progress" }, 1),
    ];
    expect(derive(issues).byId.b.reviewCurrent).toBe(false);
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

describe("derive - effective mergePolicy", () => {
  it("orders policies by the danger rank map", () => {
    expect(MERGE_POLICY_RANK.manual).toBeLessThan(MERGE_POLICY_RANK["pull-request"]);
    expect(MERGE_POLICY_RANK["pull-request"]).toBeLessThan(MERGE_POLICY_RANK.merge);
    expect(MERGE_POLICY_RANK.merge).toBeLessThan(MERGE_POLICY_RANK["fast-forward"]);
  });

  it("inherits project mergePolicy on an unset Epic and first-layer Story", () => {
    const issues = [
      project("p", 0, { mergePolicy: "pull-request" }),
      epic("e"),
      branch("b", "e"),
    ];
    const { byId } = derive(issues);
    expect(byId.p.mergePolicy).toBe("pull-request");
    expect(byId.e.mergePolicy).toBe("pull-request");
    expect(byId.b.mergePolicy).toBe("pull-request");
  });

  it("uses a stored Epic override over the Project default", () => {
    const issues = [
      project("p", 0, { mergePolicy: "pull-request" }),
      epic("e", "p", 0, { mergePolicy: "manual" }),
      branch("b", "e"),
    ];
    const { byId } = derive(issues);
    expect(byId.e.mergePolicy).toBe("manual");
    expect(byId.b.mergePolicy).toBe("manual");
  });

  it("uses a stored Story override over its parent Epic", () => {
    const issues = [
      project("p", 0, { mergePolicy: "manual" }),
      epic("e", "p", 0, { mergePolicy: "pull-request" }),
      branch("b", "e", { mergePolicy: "merge" }),
    ];
    const { byId } = derive(issues);
    expect(byId.b.mergePolicy).toBe("merge");
  });

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

  it("inherits stacked parent effective policy when the child is unset", () => {
    const issues = [
      project("p", 0, { mergePolicy: "merge" }),
      epic("e"),
      branch("base", "e", { branchName: "feat/base" }),
      branch("child", "e", { stackedOn: "base" }),
    ];
    const { byId } = derive(issues);
    expect(byId.base.mergePolicy).toBe("merge");
    expect(byId.child.mergePolicy).toBe("merge");
  });
});

describe("derive - purity", () => {
  it("takes only Issue[] and does not attach ideaStatus", () => {
    const issues = [project("p"), idea("capture", "p")];
    expect(derive.length).toBe(1);
    expect(derive(issues).byId.capture?.ideaStatus).toBeUndefined();
  });
});

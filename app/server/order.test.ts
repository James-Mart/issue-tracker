import { describe, expect, it } from "vitest";
import {
  buildProjectBoardOf,
  epicDependencyIds,
  epicsBlockedBy,
  isProjectBoardChild,
  nextSiblingOrder,
  siblingGroupKey,
  stackedStoryOrder,
  stackedOnSubtree,
} from "./order";
import type { Issue } from "./schemas";

type Story = Extract<Issue, { kind: "story" }>;
type Epic = Extract<Issue, { kind: "epic" }>;

const branch = (
  id: string,
  order: number,
  extra: Partial<Story> = {},
): Story => ({
  id,
  kind: "story",
  title: id,
  partOf: "e",
  order,
  merged: false,
  needsAttention: false,
  attentionReason: null,
  createdAt: "2026-07-10T14:00:00.000Z",
  updatedAt: "2026-07-10T14:00:00.000Z",
  ...extra,
});

const epic = (
  id: string,
  blockedBy: string[] = [],
  extra: Partial<Epic> = {},
): Epic => ({
  id,
  kind: "epic",
  title: id,
  partOf: "p",
  order: 0,
  blockedBy,
  needsAttention: false,
  attentionReason: null,
  createdAt: "2026-07-10T14:00:00.000Z",
  updatedAt: "2026-07-10T14:00:00.000Z",
  ...extra,
});

const ids = (branches: Story[]): string[] => branches.map((b) => b.id);

describe("stackedStoryOrder", () => {
  it("emits each root immediately followed by what is stacked on it (depth-first)", () => {
    const a = branch("a", 0);
    const b = branch("b", 0, { stackedOn: "a" });
    const c = branch("c", 0, { stackedOn: "b" });
    expect(ids(stackedStoryOrder([c, a, b]))).toEqual(["a", "b", "c"]);
  });

  it("orders sibling roots and sibling children by stored order", () => {
    const early = branch("early", 0);
    const late = branch("late", 1);
    const childEarly = branch("child-early", 0, { stackedOn: "early" });
    const childLate = branch("child-late", 1, { stackedOn: "early" });
    expect(ids(stackedStoryOrder([late, childLate, childEarly, early]))).toEqual([
      "early",
      "child-early",
      "child-late",
      "late",
    ]);
  });

  it("treats a stackedOn pointing outside the set as a root", () => {
    const b = branch("b", 0, { stackedOn: "not-in-set" });
    expect(ids(stackedStoryOrder([b]))).toEqual(["b"]);
  });

  it("terminates on a pure stackedOn cycle (both are children, so no root anchors traversal)", () => {
    const a = branch("a", 0, { stackedOn: "b" });
    const b = branch("b", 0, { stackedOn: "a" });
    expect(stackedStoryOrder([a, b])).toEqual([]);
  });

  it("returns an empty array for no branches", () => {
    expect(stackedStoryOrder([])).toEqual([]);
  });
});

describe("stackedOnSubtree", () => {
  it("returns the root and transitive stackedOn descendants in stackedStoryOrder", () => {
    const a = branch("a", 0);
    const b = branch("b", 0, { stackedOn: "a" });
    const c = branch("c", 0, { stackedOn: "b" });
    const d = branch("d", 1, { stackedOn: "a" });
    const z = branch("z", 2);
    const all = [z, d, c, b, a];
    expect(ids(stackedOnSubtree(all, "a"))).toEqual(["a", "b", "c", "d"]);
    expect(ids(stackedOnSubtree(all, "b"))).toEqual(["b", "c"]);
    expect(ids(stackedOnSubtree(all, "z"))).toEqual(["z"]);
  });

  it("returns empty when the root id is missing", () => {
    expect(stackedOnSubtree([branch("a", 0)], "ghost")).toEqual([]);
  });
});

describe("epic dependency edges", () => {
  it("epicDependencyIds returns an epic's blockedBy ids", () => {
    expect(epicDependencyIds(epic("t", ["a", "b"]))).toEqual(["a", "b"]);
    expect(epicDependencyIds(epic("t"))).toEqual([]);
  });

  it("epicsBlockedBy returns the epics that list a blocker, ignoring non-epics", () => {
    const a = epic("a");
    const t = epic("t", ["a"]);
    const u = epic("u", ["a", "b"]);
    const unrelated = epic("v", ["b"]);
    const notAnEpic = branch("br", 0);
    const blocked = epicsBlockedBy("a", [a, t, u, unrelated, notAnEpic]);
    expect(blocked.map((e) => e.id).sort()).toEqual(["t", "u"]);
  });
});

describe("epic + idea + project-level story shared sibling group", () => {
  const ideaIssue = (
    id: string,
    order: number,
    partOf = "p",
  ): Extract<Issue, { kind: "idea" }> => ({
    id,
    kind: "idea",
    title: id,
    partOf,
    order,
    archived: false,
    createdAt: "2026-07-10T14:00:00.000Z",
    updatedAt: "2026-07-10T14:00:00.000Z",
  });

  const projectIssue = (id: string): Issue => ({
    id,
    kind: "project",
    title: id,
    order: 0,
    createdAt: "2026-07-10T14:00:00.000Z",
    updatedAt: "2026-07-10T14:00:00.000Z",
  });

  it("puts epic and idea under the same project-keyed group", () => {
    const e = epic("e");
    const i = ideaIssue("i", 1);
    const byId = new Map(
      [projectIssue("p"), e, i].map((issue) => [issue.id, issue]),
    );
    expect(siblingGroupKey(e, byId)).toBe(siblingGroupKey(i, byId));
    expect(siblingGroupKey(e, byId)).toBe("project:p");
  });

  it("puts a project-level story in the same project-keyed group", () => {
    const p = projectIssue("p");
    const e = epic("e");
    const s = branch("s", 2, { partOf: "p" });
    const byId = new Map([p, e, s].map((issue) => [issue.id, issue]));
    expect(siblingGroupKey(s, byId)).toBe("project:p");
    expect(siblingGroupKey(s, byId)).toBe(siblingGroupKey(e, byId));
  });

  it("puts a stacked project-level story in a stack sibling group", () => {
    const p = projectIssue("p");
    const root = branch("root", 0, { partOf: "p" });
    const stacked = branch("stacked", 0, { partOf: "p", stackedOn: "root" });
    const byId = new Map([p, root, stacked].map((issue) => [issue.id, issue]));
    expect(siblingGroupKey(root, byId)).toBe("project:p");
    expect(siblingGroupKey(stacked, byId)).toBe("story:p:root");
    expect(isProjectBoardChild(root, byId)).toBe(true);
    expect(isProjectBoardChild(stacked, byId)).toBe(false);
  });

  it("keeps an epic-parented story in a story sibling group", () => {
    const p = projectIssue("p");
    const e = epic("e");
    const s = branch("s", 0, { partOf: "e" });
    const byId = new Map([p, e, s].map((issue) => [issue.id, issue]));
    expect(siblingGroupKey(s, byId)).toBe("story:e:");
  });

  it("appends nextSiblingOrder across epic, idea, and project-level story", () => {
    const p = projectIssue("p");
    const e = epic("e");
    const i = ideaIssue("i", 1);
    const issues = [p, e, i];
    expect(nextSiblingOrder(issues, "idea", "p", undefined)).toBe(2);
    expect(nextSiblingOrder(issues, "epic", "p", undefined)).toBe(2);
    expect(nextSiblingOrder(issues, "story", "p", undefined)).toBe(2);
  });

  it("buildProjectBoardOf interleaves epics, ideas, and project-level stories", () => {
    const p = projectIssue("p");
    const e = epic("e", [], { order: 1 });
    const first = ideaIssue("first", 0);
    const story = branch("solo", 2, { partOf: "p" });
    const last = ideaIssue("last", 3);
    const otherProject = ideaIssue("other", 0, "p2");
    const boardOf = buildProjectBoardOf([
      last,
      e,
      first,
      story,
      otherProject,
      p,
    ]);
    expect(boardOf.get("p")?.map((issue) => issue.id)).toEqual([
      "first",
      "e",
      "solo",
      "last",
    ]);
    expect(boardOf.get("p2")?.map((issue) => issue.id)).toEqual(["other"]);
  });
});

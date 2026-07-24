import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { buildTree, filterToProject } from "./build-tree";
import { projectBoardRoots } from "./project-board-roots";

function project(id = "p"): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    order: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

function epic(id: string, order: number, partOf = "p"): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    order,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function idea(id: string, order: number, partOf = "p"): IssueRecord {
  return {
    id,
    kind: "idea",
    title: id,
    partOf,
    order,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    archived: false,
  };
}

function story(
  id: string,
  partOf: string,
  order = 0,
  extra: Partial<IssueRecord & { kind: "story" }> = {},
): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    branchName: id,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...extra,
  };
}

function task(id: string, partOf: string, order = 0): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    order,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    status: "pending",
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

const boardIssues = [
  project(),
  idea("first", 0),
  epic("middle", 1),
  story("solo", "p", 2),
  idea("last", 3),
  story("s1", "middle"),
];

describe("filterToProject", () => {
  it("includes the project so projectBoardRoots can detect project-level stories", () => {
    const issues = [
      project(),
      epic("e", 0),
      story("solo", "p", 1),
      story("epic-child", "e"),
      story("stacked", "p", 0, { stackedOn: "solo" }),
    ];
    const scoped = filterToProject(issues, "p");
    expect(scoped.map((issue) => issue.id)).toContain("p");
    expect(projectBoardRoots(scoped, "story").map((issue) => issue.id)).toEqual(
      ["solo"],
    );
  });
});

describe("projectBoardRoots", () => {
  it("interleaves epics, ideas, and project-level stories by order", () => {
    expect(projectBoardRoots(boardIssues, "both").map((issue) => issue.id)).toEqual(
      ["first", "middle", "solo", "last"],
    );
  });

  it("shows only epics when filtered", () => {
    expect(projectBoardRoots(boardIssues, "epic").map((issue) => issue.id)).toEqual(
      ["middle"],
    );
  });

  it("shows only ideas when filtered", () => {
    expect(projectBoardRoots(boardIssues, "idea").map((issue) => issue.id)).toEqual(
      ["first", "last"],
    );
  });

  it("shows only project-level stories when filtered", () => {
    expect(projectBoardRoots(boardIssues, "story").map((issue) => issue.id)).toEqual(
      ["solo"],
    );
  });

  it("only considers issues in the input set (project-scoped upstream)", () => {
    const scoped = boardIssues.filter((issue) => issue.id !== "last");
    expect(projectBoardRoots(scoped, "both").map((issue) => issue.id)).toEqual(
      ["first", "middle", "solo"],
    );
  });
});

describe("buildTree", () => {
  it("nests stories under their epic", () => {
    const roots = projectBoardRoots(boardIssues, "both");
    const nodes = buildTree(boardIssues, roots);
    const epicNode = nodes.find((node) => node.issue.id === "middle");
    expect(epicNode?.children.map((child) => child.issue.id)).toEqual(["s1"]);
  });

  it("honors an explicit root subset without rebuilding unrelated branches", () => {
    const roots = projectBoardRoots(boardIssues, "idea");
    const nodes = buildTree(boardIssues, roots);
    expect(nodes.map((node) => node.issue.id)).toEqual(["first", "last"]);
    expect(nodes.every((node) => node.children.length === 0)).toBe(true);
  });

  it("nests tasks and stacked stories under a project-level story", () => {
    const issues = [
      project(),
      story("root", "p", 0),
      task("t1", "root", 0),
      task("t2", "root", 1),
      story("stacked", "p", 0, { stackedOn: "root" }),
    ];
    const roots = projectBoardRoots(issues, "both");
    const nodes = buildTree(issues, roots);
    expect(nodes.map((node) => node.issue.id)).toEqual(["root"]);
    expect(nodes[0]?.children.map((child) => child.issue.id)).toEqual([
      "t1",
      "t2",
      "stacked",
    ]);
  });

  it("isolates project-level stories when filtered", () => {
    const roots = projectBoardRoots(boardIssues, "story");
    const nodes = buildTree(boardIssues, roots);
    expect(nodes.map((node) => node.issue.id)).toEqual(["solo"]);
    expect(nodes.every((node) => node.children.length === 0)).toBe(true);
  });

  it("keeps tasks and stacked stories visible under story-filtered roots", () => {
    const issues = [
      project(),
      epic("e", 0),
      story("root", "p", 1),
      task("t1", "root", 0),
      story("stacked", "p", 0, { stackedOn: "root" }),
    ];
    const roots = projectBoardRoots(issues, "story");
    const nodes = buildTree(issues, roots);
    expect(nodes.map((node) => node.issue.id)).toEqual(["root"]);
    expect(nodes[0]?.children.map((child) => child.issue.id)).toEqual([
      "t1",
      "stacked",
    ]);
  });
});

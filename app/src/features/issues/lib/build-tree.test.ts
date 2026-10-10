import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { buildTree } from "./build-tree";
import { projectBoardRoots } from "./project-board-roots";

function project(id = "p"): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
}

function story(
  id: string,
  partOf: string,
  order = 0,
  extra: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
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
    reviewedTasks: [],
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
    status: "todo",
    commits: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

describe("buildTree", () => {
  it("nests tasks and stacked stories under a project-level story", () => {
    const issues = [
      project(),
      story("root", "p", 0),
      task("t1", "root", 0),
      task("t2", "root", 1),
      story("stacked", "p", 0, { stackedOn: "root" }),
    ];
    const roots = projectBoardRoots(issues, []);
    const nodes = buildTree(issues, roots);
    expect(nodes.map((node) => node.issue.id)).toEqual(["root"]);
    expect(nodes[0]?.children.map((child) => child.issue.id)).toEqual([
      "t1",
      "t2",
      "stacked",
    ]);
  });
});

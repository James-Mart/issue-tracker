import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import type { FlowItem } from "../lib/flow";
import { groupFlowItemsByProject } from "./cockpit-page";

const t0 = "2026-07-01T00:00:00.000Z";

function project(id: string, order: number): IssueRecord {
  return {
    id,
    kind: "project",
    title: `Project ${id}`,
    order,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

function epic(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function row(issue: IssueRecord): FlowItem {
  return { issue };
}

describe("groupFlowItemsByProject", () => {
  it("groups rows under one project header each and preserves project order", () => {
    const issues = [
      project("p-b", 1),
      project("p-a", 0),
      epic("e1", "p-a"),
      epic("e2", "p-b"),
      epic("e3", "p-a"),
    ];
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const items = [row(epic("e2", "p-b")), row(epic("e1", "p-a")), row(epic("e3", "p-a"))];

    const groups = groupFlowItemsByProject(items, byId, ["p-a", "p-b"]);

    expect(groups.map((group) => group.projectId)).toEqual(["p-a", "p-b"]);
    expect(groups[0]?.items.map((item) => item.issue.id)).toEqual(["e1", "e3"]);
    expect(groups[1]?.items.map((item) => item.issue.id)).toEqual(["e2"]);
    expect(groups[0]?.projectTitle).toBe("Project p-a");
  });
});

import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowItem } from "../lib/flow";
import {
  groupFlowItemsByProject,
  readyToLandEpicCaption,
} from "./cockpit-page";

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

function story(
  id: string,
  partOf: string,
  extras: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...extras,
  };
}

function flowRow(issue: IssueRecord, state?: DerivedState): FlowItem {
  return { issue, state };
}

describe("readyToLandEpicCaption", () => {
  const epicA = epic("epic-a", "p-a");
  const epicB = epic("epic-b", "p-a");
  const childA1 = story("child-a1", "epic-a");
  const childA2 = story("child-a2", "epic-a");
  const childB = story("child-b", "epic-b");
  const root = story("root", "p-a");
  const issues = [
    project("p-a", 0),
    epicA,
    epicB,
    childA1,
    childA2,
    childB,
    root,
  ];
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const prOpen: DerivedState = { blocked: false, storyStatus: "pr-open" };

  it("emits one Epic caption at the start of an adjacent sibling run", () => {
    const items = [
      flowRow(childA1, prOpen),
      flowRow(childA2, prOpen),
      flowRow(childB, prOpen),
    ];
    expect(readyToLandEpicCaption(items, 0, byId, issues)).toEqual({
      id: "epic-a",
      title: "epic-a",
    });
    expect(readyToLandEpicCaption(items, 1, byId, issues)).toBeNull();
    expect(readyToLandEpicCaption(items, 2, byId, issues)).toEqual({
      id: "epic-b",
      title: "epic-b",
    });
  });

  it("does not caption a project-level Story", () => {
    const items = [flowRow(root, prOpen), flowRow(childA1, prOpen)];
    expect(readyToLandEpicCaption(items, 0, byId, issues)).toBeNull();
    expect(readyToLandEpicCaption(items, 1, byId, issues)).toEqual({
      id: "epic-a",
      title: "epic-a",
    });
  });

  it("starts a new run after a gap in the same Epic", () => {
    const items = [
      flowRow(childA1, prOpen),
      flowRow(root, prOpen),
      flowRow(childA2, prOpen),
    ];
    expect(readyToLandEpicCaption(items, 0, byId, issues)).toEqual({
      id: "epic-a",
      title: "epic-a",
    });
    expect(readyToLandEpicCaption(items, 1, byId, issues)).toBeNull();
    expect(readyToLandEpicCaption(items, 2, byId, issues)).toEqual({
      id: "epic-a",
      title: "epic-a",
    });
  });
});

import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { canReorderBoardRoot, isBoardRootDraggable } from "./board-root-dnd";

function project(id = "p"): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    order: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

function epic(id: string, order = 0): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "p",
    order,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    needsAttention: false,
    attentionReason: null,
    archived: false,
    blockedBy: [],
  };
}

function idea(id: string, order = 0): IssueRecord {
  return {
    id,
    kind: "idea",
    title: id,
    partOf: "p",
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
  stackedOn?: string,
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
    ...(stackedOn ? { stackedOn } : {}),
  };
}

const issues: IssueRecord[] = [
  project(),
  epic("e1", 0),
  idea("i1", 1),
  story("solo", "p", 2),
  story("peer", "p", 3),
  story("child", "p", 0, "solo"),
  story("nested", "e1", 0),
];

describe("isBoardRootDraggable", () => {
  it("allows epic, idea, and root project-level story", () => {
    expect(isBoardRootDraggable(epic("e1"), issues)).toBe(true);
    expect(isBoardRootDraggable(idea("i1", 1), issues)).toBe(true);
    expect(isBoardRootDraggable(story("solo", "p", 2), issues)).toBe(true);
  });

  it("refuses stacked project-level and epic-child stories", () => {
    expect(isBoardRootDraggable(story("child", "p", 0, "solo"), issues)).toBe(
      false,
    );
    expect(isBoardRootDraggable(story("nested", "e1"), issues)).toBe(false);
  });
});

describe("canReorderBoardRoot", () => {
  it("allows epic/idea/story board-root pairs that are not story→story", () => {
    expect(canReorderBoardRoot(issues, "solo", "e1")).toBe(true);
    expect(canReorderBoardRoot(issues, "e1", "solo")).toBe(true);
    expect(canReorderBoardRoot(issues, "e1", "i1")).toBe(true);
    expect(canReorderBoardRoot(issues, "i1", "solo")).toBe(true);
  });

  it("refuses story→story (restack owns that gesture)", () => {
    expect(canReorderBoardRoot(issues, "solo", "peer")).toBe(false);
  });

  it("refuses epic-child sources and self", () => {
    expect(canReorderBoardRoot(issues, "nested", "e1")).toBe(false);
    expect(canReorderBoardRoot(issues, "e1", "e1")).toBe(false);
  });
});

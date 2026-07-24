import { describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import {
  canDropStoryOntoEpic,
  canRestackStoryOntoStory,
} from "./story-drop";
import {
  isRowDraggable,
  isStoryTreeDraggable,
  processStoryDrop,
  resolveDropAction,
} from "./story-tree-dnd-logic";

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

function story(id: string, partOf: string, stackedOn?: string): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
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

function task(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    status: "todo",
    order: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

const issues: IssueRecord[] = [
  project(),
  epic("e1", 0),
  epic("e2", 1),
  idea("i1", 2),
  story("solo", "p"),
  story("a", "e1"),
  story("b", "e1", "a"),
  story("peer", "e1"),
  story("x", "e2"),
  task("c1", "b"),
];

describe("isStoryTreeDraggable", () => {
  it("allows branches only", () => {
    expect(isStoryTreeDraggable(story("a", "e1"))).toBe(true);
    expect(isStoryTreeDraggable(epic("e1"))).toBe(false);
    expect(isStoryTreeDraggable(task("c1", "b"))).toBe(false);
  });
});

describe("isRowDraggable", () => {
  it("allows stories and board-root epics/ideas", () => {
    expect(isRowDraggable(story("a", "e1"), issues)).toBe(true);
    expect(isRowDraggable(story("solo", "p"), issues)).toBe(true);
    expect(isRowDraggable(epic("e1"), issues)).toBe(true);
    expect(isRowDraggable(idea("i1", 2), issues)).toBe(true);
  });

  it("refuses tasks", () => {
    expect(isRowDraggable(task("c1", "b"), issues)).toBe(false);
  });
});

describe("resolveDropAction", () => {
  it("restacks story→story", () => {
    expect(resolveDropAction(issues, "b", "peer")).toBe("restack");
    expect(resolveDropAction(issues, "solo", "x")).toBe("restack");
  });

  it("reorders a board-root story onto epic/idea", () => {
    expect(resolveDropAction(issues, "solo", "e1")).toBe("reorder");
    expect(resolveDropAction(issues, "solo", "i1")).toBe("reorder");
  });

  it("reparents an epic-child story onto an epic", () => {
    expect(resolveDropAction(issues, "b", "e2")).toBe("reparent");
    expect(resolveDropAction(issues, "b", "e1")).toBe("reparent");
  });

  it("prefers epic reorder over reparent for board-root sources", () => {
    expect(resolveDropAction(issues, "e2", "e1")).toBe("reorder");
    expect(canDropStoryOntoEpic(issues, "e2", "e1")).toBe(false);
  });

  it("reparents onto the project", () => {
    expect(resolveDropAction(issues, "b", "p")).toBe("reparent");
  });

  it("refuses illegal targets", () => {
    expect(resolveDropAction(issues, "b", "b")).toBeNull();
    expect(resolveDropAction(issues, "a", "b")).toBeNull();
    expect(resolveDropAction(issues, "b", "c1")).toBeNull();
  });
});

describe("processStoryDrop", () => {
  it("calls onMove for a legal restack onto a branch", () => {
    const onMove = vi.fn();
    processStoryDrop({
      sourceId: "b",
      targetId: "peer",
      canDrop: (sourceId) =>
        canRestackStoryOntoStory(issues, sourceId, "peer"),
      onMove,
    });
    expect(onMove).toHaveBeenCalledWith("b", "peer");
  });

  it("calls onMove for a legal reparent onto an epic", () => {
    const onMove = vi.fn();
    processStoryDrop({
      sourceId: "b",
      targetId: "e2",
      canDrop: (sourceId) => canDropStoryOntoEpic(issues, sourceId, "e2"),
      onMove,
    });
    expect(onMove).toHaveBeenCalledWith("b", "e2");
  });

  it("does not call onMove for illegal drops (self, descendant, commit target)", () => {
    const onMove = vi.fn();
    processStoryDrop({
      sourceId: "b",
      targetId: "b",
      canDrop: (sourceId) =>
        canRestackStoryOntoStory(issues, sourceId, "b"),
      onMove,
    });
    processStoryDrop({
      sourceId: "a",
      targetId: "b",
      canDrop: (sourceId) =>
        canRestackStoryOntoStory(issues, sourceId, "b"),
      onMove,
    });
    processStoryDrop({
      sourceId: "b",
      targetId: "c1",
      canDrop: (sourceId) => resolveDropAction(issues, sourceId, "c1") !== null,
      onMove,
    });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not call onMove when sourceId is missing", () => {
    const onMove = vi.fn();
    processStoryDrop({
      sourceId: null,
      targetId: "peer",
      canDrop: () => true,
      onMove,
    });
    expect(onMove).not.toHaveBeenCalled();
  });
});

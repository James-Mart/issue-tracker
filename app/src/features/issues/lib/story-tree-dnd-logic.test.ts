import { describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { canRestackStoryOntoStory } from "./story-drop";
import { processStoryDrop, resolveDropAction } from "./story-tree-dnd-logic";
import { buildTreeRowIndexes } from "./tree-row-indexes";

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
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...(stackedOn ? { stackedOn } : {}),
  };
}

function epic(id: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    needsAttention: false,
    attentionReason: null,
    archived: false,
    blockedBy: [],
  };
}

function task(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    status: "todo",
    commits: [],
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
  epic("e1"),
  story("a", "e1"),
  story("b", "e1", "a"),
  task("c1", "b"),
];

const indexes = buildTreeRowIndexes(issues);

describe("processStoryDrop", () => {
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
      canDrop: (sourceId) => resolveDropAction(issues, sourceId, "c1", indexes) !== null,
      onMove,
    });
    expect(onMove).not.toHaveBeenCalled();
  });
});

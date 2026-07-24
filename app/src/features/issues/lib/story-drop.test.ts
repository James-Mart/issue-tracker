import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import {
  canDropStoryOntoEpic,
  canDropStoryOntoProject,
  canRestackStoryOntoStory,
} from "./story-drop";

function story(
  id: string,
  partOf: string,
  stackedOn?: string,
): IssueRecord {
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
  };
}

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

const issues: IssueRecord[] = [
  project(),
  epic("e1"),
  epic("e2"),
  story("a", "e1"),
  story("b", "e1", "a"),
  story("c", "e1", "b"),
  story("peer", "e1"),
  story("x", "e2"),
  story("solo", "p"),
  story("stacked", "p", "solo"),
];

describe("canRestackStoryOntoStory", () => {
  it("allows restack onto a peer in the same epic", () => {
    expect(canRestackStoryOntoStory(issues, "b", "peer")).toBe(true);
  });

  it("allows restack onto a branch in another epic", () => {
    expect(canRestackStoryOntoStory(issues, "b", "x")).toBe(true);
  });

  it("refuses self", () => {
    expect(canRestackStoryOntoStory(issues, "b", "b")).toBe(false);
  });

  it("refuses stackedOn descendants", () => {
    expect(canRestackStoryOntoStory(issues, "a", "b")).toBe(false);
    expect(canRestackStoryOntoStory(issues, "a", "c")).toBe(false);
  });

  it("refuses unknown source", () => {
    expect(canRestackStoryOntoStory(issues, "ghost", "a")).toBe(false);
  });
});

describe("canDropStoryOntoEpic", () => {
  it("allows reparent onto another epic", () => {
    expect(canDropStoryOntoEpic(issues, "b", "e2")).toBe(true);
  });

  it("allows unstack onto its own epic", () => {
    expect(canDropStoryOntoEpic(issues, "b", "e1")).toBe(true);
  });

  it("refuses unknown source", () => {
    expect(canDropStoryOntoEpic(issues, "ghost", "e1")).toBe(false);
  });

  it("refuses non-epic targets", () => {
    expect(canDropStoryOntoEpic(issues, "b", "a")).toBe(false);
  });
});

describe("canDropStoryOntoProject", () => {
  it("allows reparent/unstack onto the project", () => {
    expect(canDropStoryOntoProject(issues, "stacked", "p")).toBe(true);
    expect(canDropStoryOntoProject(issues, "b", "p")).toBe(true);
  });

  it("refuses unknown source and non-project targets", () => {
    expect(canDropStoryOntoProject(issues, "ghost", "p")).toBe(false);
    expect(canDropStoryOntoProject(issues, "b", "e1")).toBe(false);
  });
});

describe("canRestackStoryOntoStory — project-level", () => {
  it("allows stacking among project-level stories", () => {
    expect(canRestackStoryOntoStory(issues, "solo", "x")).toBe(true);
    expect(canRestackStoryOntoStory(issues, "stacked", "solo")).toBe(true);
  });

  it("refuses stacking a root onto its stacked descendant", () => {
    expect(canRestackStoryOntoStory(issues, "solo", "stacked")).toBe(false);
  });
});

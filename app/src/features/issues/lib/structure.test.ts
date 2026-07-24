import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { structureScopedIssues, structureTreeNodes } from "./structure";

const timestamps = {
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

function project(id: string): IssueRecord {
  return { id, kind: "project", title: id, ...timestamps };
}

function epic(id: string, partOf: string, order = 0): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    order,
    ...timestamps,
  };
}

function story(id: string, partOf: string, order = 0): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order,
    ...timestamps,
  };
}

function idea(id: string, partOf: string, order = 0): IssueRecord {
  return {
    id,
    kind: "idea",
    title: id,
    partOf,
    order,
    ...timestamps,
  };
}

describe("structureScopedIssues", () => {
  it("scopes to the project and hides archived by default", () => {
    const issues: IssueRecord[] = [
      project("p1"),
      epic("e1", "p1"),
      { ...epic("e2", "p1"), archived: true },
      project("p2"),
      epic("e3", "p2"),
    ];
    expect(
      structureScopedIssues(issues, "p1", false).map((i) => i.id),
    ).toEqual(["p1", "e1"]);
    expect(
      structureScopedIssues(issues, "p1", true).map((i) => i.id),
    ).toEqual(["p1", "e1", "e2"]);
  });
});

describe("structureTreeNodes", () => {
  const scoped: IssueRecord[] = [
    project("p"),
    epic("e1", "p", 0),
    story("s1", "e1", 0),
    idea("i1", "p", 1),
    epic("e2", "p", 2),
  ];

  it("builds board roots in order", () => {
    const nodes = structureTreeNodes(scoped, {
      search: "",
      labelIds: [],
      kind: "both",
    });
    expect(nodes.map((n) => n.issue.id)).toEqual(["e1", "i1", "e2"]);
    expect(nodes[0]!.children.map((c) => c.issue.id)).toEqual(["s1"]);
  });

  it("filters by kind", () => {
    const ideas = structureTreeNodes(scoped, {
      search: "",
      labelIds: [],
      kind: "idea",
    });
    expect(ideas.map((n) => n.issue.id)).toEqual(["i1"]);
  });

  it("filters by search while keeping ancestors", () => {
    const nodes = structureTreeNodes(scoped, {
      search: "s1",
      labelIds: [],
      kind: "both",
    });
    expect(nodes.map((n) => n.issue.id)).toEqual(["e1"]);
    expect(nodes[0]!.children.map((c) => c.issue.id)).toEqual(["s1"]);
  });
});

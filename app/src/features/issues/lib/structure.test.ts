import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { structureScopedIssues, structureIdeaNodes, structureTreeNodes } from "./structure";

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

  it("builds hierarchy roots in order without ideas", () => {
    const nodes = structureTreeNodes(scoped, {
      search: "",
      labelIds: [],
      kind: [],
    });
    expect(nodes.map((n) => n.issue.id)).toEqual(["e1", "e2"]);
    expect(nodes[0]!.children.map((c) => c.issue.id)).toEqual(["s1"]);
  });

  it("filters ideas into structureIdeaNodes", () => {
    const ideas = structureIdeaNodes(scoped, {
      search: "",
      labelIds: [],
      kind: [],
    });
    expect(ideas.map((n) => n.issue.id)).toEqual(["i1"]);

    const ideasOnly = structureTreeNodes(scoped, {
      search: "",
      labelIds: [],
      kind: ["idea"],
    });
    expect(ideasOnly).toEqual([]);

    const epicsAndStories = structureTreeNodes(scoped, {
      search: "",
      labelIds: [],
      kind: ["epic", "story"],
    });
    expect(epicsAndStories.map((n) => n.issue.id)).toEqual(["e1", "e2"]);
  });

  it("hides ideas when kind filter excludes them", () => {
    const ideas = structureIdeaNodes(scoped, {
      search: "",
      labelIds: [],
      kind: ["epic"],
    });
    expect(ideas).toEqual([]);
  });

  it("filters by search while keeping ancestors", () => {
    const nodes = structureTreeNodes(scoped, {
      search: "s1",
      labelIds: [],
      kind: [],
    });
    expect(nodes.map((n) => n.issue.id)).toEqual(["e1"]);
    expect(nodes[0]!.children.map((c) => c.issue.id)).toEqual(["s1"]);
  });
});

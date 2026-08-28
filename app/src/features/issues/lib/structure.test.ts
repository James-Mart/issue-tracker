import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  structureDoneNodes,
  structureScopedIssues,
  structureIdeaNodes,
  structureTreeNodes,
} from "./structure";

const timestamps = {
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

const emptyFilters = {
  search: "",
  labelIds: [] as string[],
  kind: [] as const,
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
    const nodes = structureTreeNodes(scoped, emptyFilters, {});
    expect(nodes.map((n) => n.issue.id)).toEqual(["e1", "e2"]);
    expect(nodes[0]!.children.map((c) => c.issue.id)).toEqual(["s1"]);
  });

  it("filters ideas into structureIdeaNodes", () => {
    const ideas = structureIdeaNodes(scoped, emptyFilters);
    expect(ideas.map((n) => n.issue.id)).toEqual(["i1"]);

    const ideasOnly = structureTreeNodes(scoped, {
      ...emptyFilters,
      kind: ["idea"],
    }, {});
    expect(ideasOnly).toEqual([]);

    const epicsAndStories = structureTreeNodes(scoped, {
      ...emptyFilters,
      kind: ["epic", "story"],
    }, {});
    expect(epicsAndStories.map((n) => n.issue.id)).toEqual(["e1", "e2"]);
  });

  it("hides ideas when kind filter excludes them", () => {
    const ideas = structureIdeaNodes(scoped, {
      ...emptyFilters,
      kind: ["epic"],
    });
    expect(ideas).toEqual([]);
  });

  it("filters by search while keeping ancestors", () => {
    const nodes = structureTreeNodes(scoped, {
      ...emptyFilters,
      search: "s1",
    }, {});
    expect(nodes.map((n) => n.issue.id)).toEqual(["e1"]);
    expect(nodes[0]!.children.map((c) => c.issue.id)).toEqual(["s1"]);
  });
});

describe("structureDoneNodes", () => {
  const scoped: IssueRecord[] = [
    project("p"),
    epic("active-epic", "p", 0),
    story("child-merged", "active-epic", 0),
    epic("done-epic", "p", 1),
    story("done-story", "p", 2),
    idea("planned-idea", "p", 3),
  ];

  const derived: Record<string, DerivedState> = {
    "done-epic": { blocked: false, epicStatus: "done" },
    "done-story": { blocked: false, storyStatus: "merged" },
    "child-merged": { blocked: false, storyStatus: "merged" },
  };

  it("moves complete board roots off the rail into Done in board order", () => {
    const rail = structureTreeNodes(scoped, emptyFilters, derived);
    const done = structureDoneNodes(scoped, emptyFilters, derived);

    expect(rail.map((n) => n.issue.id)).toEqual(["active-epic"]);
    expect(rail[0]!.children.map((c) => c.issue.id)).toEqual(["child-merged"]);
    expect(done.map((n) => n.issue.id)).toEqual(["done-epic", "done-story"]);
  });

  it("keeps an in-progress epic on the rail when a child story is merged", () => {
    const rail = structureTreeNodes(scoped, emptyFilters, derived);
    expect(rail.some((n) => n.issue.id === "active-epic")).toBe(true);
    expect(
      structureDoneNodes(scoped, emptyFilters, derived).some(
        (n) => n.issue.id === "active-epic",
      ),
    ).toBe(false);
  });

  it("leaves planned ideas in structureIdeaNodes", () => {
    const ideas = structureIdeaNodes(scoped, emptyFilters);
    expect(ideas.map((n) => n.issue.id)).toEqual(["planned-idea"]);
    expect(
      structureDoneNodes(scoped, emptyFilters, derived).some(
        (n) => n.issue.id === "planned-idea",
      ),
    ).toBe(false);
  });

  it("applies search and kind filters to Done", () => {
    const doneBySearch = structureDoneNodes(
      scoped,
      { ...emptyFilters, search: "done-story" },
      derived,
    );
    expect(doneBySearch.map((n) => n.issue.id)).toEqual(["done-story"]);

    const doneByKind = structureDoneNodes(
      scoped,
      { ...emptyFilters, kind: ["epic"] },
      derived,
    );
    expect(doneByKind.map((n) => n.issue.id)).toEqual(["done-epic"]);
  });

  it("returns no Done nodes when none are complete", () => {
    expect(structureDoneNodes(scoped, emptyFilters, {})).toEqual([]);
  });
});

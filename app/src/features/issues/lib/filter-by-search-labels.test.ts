import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { filterIssuesBySearchAndLabels } from "./filter-by-search-labels";

const timestamps = {
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

function epic(id: string, title: string, labels: string[] = []): IssueRecord {
  return {
    id,
    kind: "epic",
    title,
    partOf: "p",
    order: 0,
    labels,
    ...timestamps,
  };
}

function story(
  id: string,
  title: string,
  partOf: string,
  labels: string[] = [],
): IssueRecord {
  return {
    id,
    kind: "story",
    title,
    partOf,
    order: 0,
    labels,
    ...timestamps,
  };
}

describe("filterIssuesBySearchAndLabels", () => {
  const issues: IssueRecord[] = [
    epic("e1", "Alpha epic", ["bug"]),
    story("s1", "Beta story", "e1"),
    epic("e2", "Gamma", ["feat"]),
    story("s2", "Delta task-ish", "e2", ["bug"]),
  ];

  it("returns all issues when filters are empty", () => {
    expect(filterIssuesBySearchAndLabels(issues, "", []).map((i) => i.id)).toEqual(
      ["e1", "s1", "e2", "s2"],
    );
  });

  it("keeps ancestors when a child matches search", () => {
    const filtered = filterIssuesBySearchAndLabels(issues, "Beta", []);
    expect(filtered.map((i) => i.id).sort()).toEqual(["e1", "s1"]);
  });

  it("keeps ancestors when a child matches labels", () => {
    const filtered = filterIssuesBySearchAndLabels(issues, "", ["bug"]);
    expect(filtered.map((i) => i.id).sort()).toEqual(["e1", "e2", "s2"]);
  });

  it("keeps a labeled Epic when search matches a child (tree semantics)", () => {
    // First pass keeps epic+story; second keeps the labeled epic (child drops).
    const filtered = filterIssuesBySearchAndLabels(issues, "Beta", ["bug"]);
    expect(filtered.map((i) => i.id)).toEqual(["e1"]);
  });

  it("returns empty when sequential passes leave nothing", () => {
    expect(filterIssuesBySearchAndLabels(issues, "Gamma", ["bug"])).toEqual([]);
  });
});

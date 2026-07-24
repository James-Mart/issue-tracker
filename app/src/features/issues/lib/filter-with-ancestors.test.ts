import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { filterWithAncestors } from "./filter-with-ancestors";
import { issueMatchesLabelFilter } from "./project-labels";

function epic(id: string, labels?: string[]): IssueRecord {
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
    blockedBy: [],
    archived: false,
    ...(labels ? { labels } : {}),
  };
}

function story(
  id: string,
  partOf: string,
  opts?: { labels?: string[]; stackedOn?: string },
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
    ...(opts?.labels ? { labels: opts.labels } : {}),
    ...(opts?.stackedOn ? { stackedOn: opts.stackedOn } : {}),
  };
}

describe("filterWithAncestors", () => {
  it("keeps label matches and epic ancestors", () => {
    const e = epic("e");
    const s = story("s", "e", { labels: ["bug"] });
    const other = story("other", "e", { labels: ["feat"] });
    const filtered = filterWithAncestors(
      [e, s, other],
      (issue) => issueMatchesLabelFilter(issue, ["bug"]),
    );
    expect(filtered.map((issue) => issue.id)).toEqual(["e", "s"]);
  });

  it("keeps stack ancestors of a nested match", () => {
    const e = epic("e");
    const base = story("base", "e");
    const nested = story("nested", "e", {
      labels: ["bug"],
      stackedOn: "base",
    });
    const filtered = filterWithAncestors(
      [e, base, nested],
      (issue) => issueMatchesLabelFilter(issue, ["bug"]),
    );
    expect(filtered.map((issue) => issue.id)).toEqual(["e", "base", "nested"]);
  });

  it("returns all issues when every issue matches", () => {
    const issues = [epic("e"), story("s", "e")];
    expect(
      filterWithAncestors(issues, () => true).map((issue) => issue.id),
    ).toEqual(["e", "s"]);
  });
});

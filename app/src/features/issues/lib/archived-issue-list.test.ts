import { describe, expect, it } from "vitest";
import type { IssueRecord, IssuesResponse } from "@server/schemas";
import {
  mergeLiveWithArchivedOnly,
  missingChainIds,
} from "./archived-issue-list";

const at = "2026-07-09T14:00:00.000Z";

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: at,
    updatedAt: at,
  };
}

function story(
  id: string,
  partOf: string,
  archived: boolean,
): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived,
    createdAt: at,
    updatedAt: at,
  };
}

function response(issues: IssueRecord[]): IssuesResponse {
  return {
    issues,
    problems: issues.map((issue) => ({ id: issue.id, message: issue.id })),
    derived: Object.fromEntries(
      issues.map((issue) => [issue.id, { blocked: false }]),
    ),
  };
}

describe("mergeLiveWithArchivedOnly", () => {
  const liveStory = story("live", "p", false);
  const oldOnLive = story("old", "p", true);
  const oldOnOnly = { ...oldOnLive, title: "from only" };
  const added = story("added", "p", true);

  it("takes archived rows from the flagged list", () => {
    const merged = mergeLiveWithArchivedOnly(
      response([project("p"), liveStory, oldOnLive]),
      response([oldOnOnly, added]),
    );
    expect(merged.issues.map((issue) => issue.id)).toEqual([
      "p",
      "live",
      "old",
      "added",
    ]);
    expect(merged.issues.find((issue) => issue.id === "old")?.title).toBe(
      "from only",
    );
    expect(merged.derived.old).toEqual({ blocked: false });
    expect(merged.problems.map((problem) => problem.id).sort()).toEqual([
      "added",
      "live",
      "old",
      "p",
    ]);
  });

  it("leaves a live-only payload unchanged when the flagged list repeats it", () => {
    const live = response([project("p"), liveStory]);
    const merged = mergeLiveWithArchivedOnly(live, live);
    expect(merged.issues).toEqual(live.issues);
    expect(merged.derived).toEqual(live.derived);
  });
});

describe("missingChainIds", () => {
  const projectRecord = project("p");
  const parent = story("parent", "p", true);
  const child = story("child", "parent", false);

  it("asks for a missing root and stops", () => {
    const byId = new Map([["p", projectRecord]]);
    expect(missingChainIds(["child"], byId)).toEqual(["child"]);
    expect(missingChainIds(["child"], byId, true)).toEqual(["child"]);
  });

  it("walks ancestors only when asked", () => {
    const byId = new Map<string, IssueRecord>([
      ["child", child],
      ["p", projectRecord],
    ]);
    expect(missingChainIds(["child"], byId)).toEqual([]);
    expect(missingChainIds(["child"], byId, true)).toEqual(["parent"]);
  });

  it("stops once the chain is present", () => {
    const byId = new Map<string, IssueRecord>([
      ["child", child],
      ["parent", parent],
      ["p", projectRecord],
    ]);
    expect(missingChainIds(["child"], byId, true)).toEqual([]);
  });
});

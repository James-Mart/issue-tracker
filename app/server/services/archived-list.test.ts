import { describe, expect, it } from "vitest";
import type { IssueRecord, IssuesResponse } from "../schemas.js";
import { IssueError } from "./errors.js";
import {
  applyArchivedListQuery,
  parseArchivedListQuery,
} from "./archived-list.js";

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

function story(id: string, archived: boolean): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "p",
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

function response(): IssuesResponse {
  return {
    issues: [project("p"), story("live", false), story("old", true)],
    problems: [
      { id: "live", message: "live" },
      { id: "old", message: "old" },
    ],
    derived: {
      live: { blocked: false, storyStatus: "not-started" },
      old: { blocked: false, storyStatus: "merged" },
    },
  };
}

describe("parseArchivedListQuery", () => {
  it("treats an omitted flag as the current full list", () => {
    expect(parseArchivedListQuery(undefined)).toBeUndefined();
  });

  it("accepts include and only", () => {
    expect(parseArchivedListQuery("include")).toBe("include");
    expect(parseArchivedListQuery("only")).toBe("only");
  });

  it("rejects any other value", () => {
    expect(() => parseArchivedListQuery("true")).toThrow(IssueError);
    expect(() => parseArchivedListQuery("")).toThrow(IssueError);
    expect(() => parseArchivedListQuery(["only"])).toThrow(IssueError);
  });
});

describe("applyArchivedListQuery", () => {
  it("keeps the full payload for the default and include", () => {
    const full = response();
    expect(applyArchivedListQuery(full, undefined)).toBe(full);
    expect(applyArchivedListQuery(full, "include")).toBe(full);
  });

  it("returns archived issues only", () => {
    expect(applyArchivedListQuery(response(), "only")).toEqual({
      issues: [story("old", true)],
      problems: [{ id: "old", message: "old" }],
      derived: { old: { blocked: false, storyStatus: "merged" } },
    });
  });
});

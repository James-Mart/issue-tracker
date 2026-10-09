import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { flowBuckets, type FlowBuckets } from "./flow";

const t0 = "2026-07-01T00:00:00.000Z";
const t1 = "2026-07-02T00:00:00.000Z";
const t2 = "2026-07-03T00:00:00.000Z";

type StoryRecord = Extract<IssueRecord, { kind: "story" }>;

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
  };
}

function epic(id: string, partOf: string, updatedAt = t0): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function story(
  id: string,
  partOf: string,
  extras: Partial<StoryRecord> = {},
): StoryRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: extras.updatedAt ?? t0,
    branchName: id,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...extras,
  };
}

function ids(buckets: FlowBuckets): string[] {
  return buckets.recentlyMerged.map((item) => item.issue.id);
}

function placedIds(buckets: FlowBuckets): string[] {
  return [
    ...buckets.awaitingPlanning,
    ...buckets.readyToLand,
    ...buckets.ready,
    ...buckets.inFlight,
    ...buckets.blocked,
    ...buckets.recentlyMerged,
  ].map((item) => item.issue.id);
}

describe("recently merged merge time", () => {
  it("orders project Stories and done Epics by merge instant across projects", () => {
    const issues = [
      project("alpha"),
      project("beta"),
      story("alpha-old", "alpha", { merged: true, mergedAt: t0, updatedAt: t2 }),
      epic("alpha-stack", "alpha", t2),
      story("alpha-early", "alpha-stack", { mergedAt: t0 }),
      story("alpha-late", "alpha-stack", { mergedAt: t1 }),
      story("beta-new", "beta", { merged: true, mergedAt: t2, updatedAt: t0 }),
    ];
    const derived: Record<string, DerivedState> = {
      "alpha-old": { blocked: false, storyStatus: "merged" },
      "alpha-stack": { blocked: false, epicStatus: "done" },
      "alpha-early": { blocked: false, storyStatus: "merged" },
      "alpha-late": { blocked: false, storyStatus: "merged" },
      "beta-new": { blocked: false, storyStatus: "merged" },
    };

    const buckets = flowBuckets(issues, derived, {});

    expect(ids(buckets)).toEqual(["beta-new", "alpha-stack", "alpha-old"]);
  });

  it("tie-breaks equal instants on issue id, smaller id first", () => {
    const same = "2026-07-01T00:00:00Z";
    const issues = [
      project("p"),
      story("m-b", "p", { merged: true, mergedAt: t0 }),
      story("m-a", "p", { merged: true, mergedAt: same }),
      epic("m-c", "p"),
      story("m-c-child", "m-c", { mergedAt: "2026-07-01T00:00:00.000Z" }),
    ];
    const derived: Record<string, DerivedState> = {
      "m-b": { blocked: false, storyStatus: "merged" },
      "m-a": { blocked: false, storyStatus: "merged" },
      "m-c": { blocked: false, epicStatus: "done" },
      "m-c-child": { blocked: false, storyStatus: "merged" },
    };

    expect(ids(flowBuckets(issues, derived, {}))).toEqual(["m-a", "m-b", "m-c"]);
  });

  it("omits rows with no merge time and leaves other buckets alone", () => {
    const issues = [
      project("p"),
      story("no-stamp", "p", { merged: true, updatedAt: t2 }),
      story("bad-stamp", "p", { merged: true, mergedAt: "not-a-date" }),
      epic("no-children", "p", t2),
      epic("blank-children", "p"),
      story("blank-child", "blank-children", { merged: true }),
      epic("grandchild-only", "p"),
      story("direct-blank", "grandchild-only"),
      story("grandchild", "direct-blank", { merged: true, mergedAt: t2 }),
      story("kept", "p", { merged: true, mergedAt: t0 }),
      epic("ready-epic", "p"),
    ];
    const derived: Record<string, DerivedState> = {
      "no-stamp": { blocked: false, storyStatus: "merged" },
      "bad-stamp": { blocked: false, storyStatus: "merged" },
      "no-children": { blocked: false, epicStatus: "done" },
      "blank-children": { blocked: false, epicStatus: "done" },
      "blank-child": { blocked: false, storyStatus: "merged" },
      "grandchild-only": { blocked: false, epicStatus: "done" },
      "direct-blank": { blocked: false, storyStatus: "merged" },
      grandchild: { blocked: false, storyStatus: "merged" },
      kept: { blocked: false, storyStatus: "merged" },
      "ready-epic": { blocked: false, epicStatus: "todo" },
    };

    const buckets = flowBuckets(issues, derived, {});

    expect(ids(buckets)).toEqual(["kept"]);
    expect(placedIds(buckets)).toEqual(["ready-epic", "kept"]);
  });

  it("uses a valid child stamp when a sibling stamp does not parse", () => {
    const issues = [
      project("p"),
      epic("done", "p"),
      story("bad", "done", { mergedAt: "not-a-date" }),
      story("good", "done", { mergedAt: t1 }),
    ];
    const derived: Record<string, DerivedState> = {
      done: { blocked: false, epicStatus: "done" },
      bad: { blocked: false, storyStatus: "merged" },
      good: { blocked: false, storyStatus: "merged" },
    };

    expect(ids(flowBuckets(issues, derived, {}))).toEqual(["done"]);
  });
});

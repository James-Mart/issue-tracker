import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  flowBuckets,
  isReadyWorkFlowItem,
} from "./flow";

type EpicRecord = Extract<IssueRecord, { kind: "epic" }>;
type StoryRecord = Extract<IssueRecord, { kind: "story" }>;

const t0 = "2026-07-01T00:00:00.000Z";
const t1 = "2026-07-02T00:00:00.000Z";
const t2 = "2026-07-03T00:00:00.000Z";

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

function epic(id: string, partOf: string): EpicRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function story(id: string, partOf: string): StoryRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

function ids(items: { issue: IssueRecord }[]): string[] {
  return items.map((item) => item.issue.id);
}

describe("flowBuckets work queue", () => {
  it("places a queued ready root in inFlight instead of ready", () => {
    const issues = [
      project("p"),
      { ...epic("queued-epic", "p"), workQueuedAt: t1 },
      {
        ...story("queued-story", "p"),
        workQueuedAt: t2,
      },
      epic("ready-epic", "p"),
    ];
    const derived: Record<string, DerivedState> = {
      "queued-epic": { blocked: false, epicStatus: "todo" },
      "queued-story": { blocked: false, storyStatus: "not-started" },
      "ready-epic": { blocked: false, epicStatus: "todo" },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });

    expect(ids(buckets.inFlight).sort()).toEqual(
      ["queued-epic", "queued-story"].sort(),
    );
    expect(ids(buckets.ready)).toEqual(["ready-epic"]);
    expect(buckets.blocked).toEqual([]);
  });

  it("keeps a queued blocked root in blocked", () => {
    const issues = [
      project("p"),
      { ...epic("queued-blocked", "p"), workQueuedAt: t1 },
      { ...story("queued-blocked-story", "p"), workQueuedAt: t2 },
    ];
    const derived: Record<string, DerivedState> = {
      "queued-blocked": { blocked: true, epicStatus: "todo" },
      "queued-blocked-story": {
        blocked: true,
        storyStatus: "not-started",
      },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });

    expect(ids(buckets.blocked).sort()).toEqual(
      ["queued-blocked", "queued-blocked-story"].sort(),
    );
    expect(buckets.inFlight).toEqual([]);
    expect(buckets.ready).toEqual([]);
  });
});

describe("isReadyWorkFlowItem work queue", () => {
  it("returns false when the work root is queued", () => {
    expect(
      isReadyWorkFlowItem({
        issue: { ...epic("e", "p"), workQueuedAt: t1 },
        state: { blocked: false, epicStatus: "todo" },
      }),
    ).toBe(false);
    expect(
      isReadyWorkFlowItem({
        issue: { ...story("s", "p"), workQueuedAt: t1 },
        state: { blocked: false, storyStatus: "not-started" },
      }),
    ).toBe(false);
  });
});

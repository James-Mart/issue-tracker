import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { visibleIssues } from "@server/services/archived-visibility";
import { partitionCockpitBuckets } from "../components/flow-buckets-sections";
import { flowBuckets } from "./flow";

type EpicRecord = Extract<IssueRecord, { kind: "epic" }>;
type StoryRecord = Extract<IssueRecord, { kind: "story" }>;

const t0 = "2026-07-01T00:00:00.000Z";

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

describe("flowBuckets", () => {
  it("assigns each Story/Epic to exactly one bucket by precedence", () => {
    const issues = [
      project("p"),
      epic("blocked-epic", "p"),
      story("blocked-story", "blocked-epic"),
      epic("flight-epic", "p"),
      story("flight-story", "flight-epic"),
      story("pr-story", "flight-epic"),
      epic("done-epic", "p"),
      { ...story("merged-story", "done-epic"), mergedAt: t0 },
      epic("ready-epic", "p"),
      story("ready-story", "ready-epic"),
    ];
    const derived: Record<string, DerivedState> = {
      "blocked-epic": { blocked: true, epicStatus: "in-progress" },
      "blocked-story": { blocked: true, storyStatus: "pr-open" },
      "flight-epic": { blocked: false, epicStatus: "in-progress" },
      "flight-story": { blocked: false, storyStatus: "in-progress" },
      "pr-story": { blocked: false, storyStatus: "pr-open" },
      "done-epic": { blocked: false, epicStatus: "done" },
      "merged-story": { blocked: false, storyStatus: "merged" },
      "ready-epic": { blocked: false, epicStatus: "todo" },
      "ready-story": { blocked: false, storyStatus: "not-started" },
    };

    const buckets = flowBuckets(issues, derived, { projectId: "p" });

    expect(ids(buckets.blocked).sort()).toEqual(
      ["blocked-epic", "blocked-story"].sort(),
    );
    expect(ids(buckets.inFlight).sort()).toEqual(["flight-epic"].sort());
    expect(ids(buckets.recentlyMerged).sort()).toEqual(["done-epic"].sort());
    expect(ids(buckets.ready).sort()).toEqual(["ready-epic"].sort());
    expect(ids(buckets.readyToLand)).toEqual(["pr-story"]);
  });

  it("locks cockpit vs project Flow Ready agreement across projects", () => {
    const issues = [
      project("project-a"),
      project("project-b"),
      epic("a-live-ready", "project-a"),
      { ...epic("a-archived-ready", "project-a"), archived: true },
      epic("b-live-ready", "project-b"),
    ];
    const derived: Record<string, DerivedState> = {
      "a-live-ready": { blocked: false, epicStatus: "todo" },
      "a-archived-ready": { blocked: false, epicStatus: "todo" },
      "b-live-ready": { blocked: false, epicStatus: "todo" },
    };

    const visible = visibleIssues(issues, false);

    const cockpitReady = ids(
      partitionCockpitBuckets(flowBuckets(visible, derived, {})).buckets.ready,
    );
    expect(cockpitReady.sort()).toEqual(["a-live-ready", "b-live-ready"].sort());
    expect(cockpitReady).not.toContain("a-archived-ready");

    const projectAReady = ids(
      partitionCockpitBuckets(
        flowBuckets(visible, derived, { projectId: "project-a" }),
      ).buckets.ready,
    );
    expect(projectAReady).toEqual(["a-live-ready"]);
  });
});

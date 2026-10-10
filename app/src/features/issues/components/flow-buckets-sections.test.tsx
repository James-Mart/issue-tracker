import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowBuckets, FlowItem } from "../lib/flow";
import { partitionCockpitBuckets } from "./flow-buckets-sections";

const t0 = "2026-07-01T00:00:00.000Z";

function idea(id: string): IssueRecord {
  return {
    id,
    kind: "idea",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

function story(id: string): Extract<IssueRecord, { kind: "story" }> {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "p",
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

function epic(id: string, needsAttention = false): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention,
    attentionReason: needsAttention ? "check" : null,
    blockedBy: [],
    archived: false,
  };
}

function row(issue: IssueRecord, state?: DerivedState): FlowItem {
  return { issue, state };
}

function emptyBuckets(
  overrides: Partial<FlowBuckets> = {},
): FlowBuckets {
  return {
    awaitingPlanning: [],
    readyToLand: [],
    ready: [],
    inFlight: [],
    blocked: [],
    recentlyMerged: [],
    ...overrides,
  };
}

describe("partitionCockpitBuckets", () => {
  it("lifts needs-attention rows out of lifecycle buckets", () => {
    const flagged = row(epic("flagged", true), {
      blocked: false,
      epicStatus: "todo",
    });
    const ready = row(epic("ready"), { blocked: false, epicStatus: "todo" });
    const inFlight = row(epic("flight"), {
      blocked: false,
      epicStatus: "in-progress",
    });

    const partitioned = partitionCockpitBuckets(
      emptyBuckets({
        ready: [flagged, ready],
        inFlight: [inFlight],
      }),
    );

    expect(partitioned.needsAttention.map((item) => item.issue.id)).toEqual([
      "flagged",
    ]);
    expect(partitioned.buckets.ready.map((item) => item.issue.id)).toEqual([
      "ready",
    ]);
    expect(partitioned.buckets.inFlight.map((item) => item.issue.id)).toEqual([
      "flight",
    ]);
  });

  it("lifts awaiting-direction Ideas and leaves an implementing Story in place", () => {
    const awaiting = row(idea("awaiting"), {
      blocked: false,
      ideaStatus: "awaiting-direction",
    });
    const implementing = row(story("implementing"), {
      blocked: false,
      storyStatus: "in-progress",
    });

    const partitioned = partitionCockpitBuckets(
      emptyBuckets({
        ready: [awaiting],
        inFlight: [implementing],
      }),
    );

    expect(partitioned.needsAttention.map((item) => item.issue.id)).toEqual([
      "awaiting",
    ]);
    expect(partitioned.buckets.ready).toEqual([]);
    expect(partitioned.buckets.inFlight.map((item) => item.issue.id)).toEqual([
      "implementing",
    ]);
  });
});

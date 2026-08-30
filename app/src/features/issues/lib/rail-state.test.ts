import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { issueRailNodeState } from "./rail-state";

const timestamps = {
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

function task(
  status: Extract<IssueRecord, { kind: "task" }>["status"],
  extras: Partial<Extract<IssueRecord, { kind: "task" }>> = {},
): IssueRecord {
  return {
    id: "t",
    kind: "task",
    title: "t",
    partOf: "story",
    status,
    ...timestamps,
    ...extras,
  };
}

function story(
  extras: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
): IssueRecord {
  return {
    id: "s",
    kind: "story",
    title: "s",
    partOf: "epic",
    branchName: "s",
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    ...timestamps,
    ...extras,
  };
}

function idea(): IssueRecord {
  return {
    id: "i",
    kind: "idea",
    title: "i",
    partOf: "project",
    archived: false,
    ...timestamps,
  };
}

function epic(
  extras: Partial<Extract<IssueRecord, { kind: "epic" }>> = {},
): IssueRecord {
  return {
    id: "e",
    kind: "epic",
    title: "e",
    partOf: "project",
    needsAttention: false,
    attentionReason: null,
    archived: false,
    blockedBy: [],
    ...timestamps,
    ...extras,
  };
}

describe("issueRailNodeState", () => {
  it("maps ready / in-flight / merged for tasks", () => {
    expect(issueRailNodeState(task("todo"), undefined)).toBe("ready");
    expect(issueRailNodeState(task("in-progress"), undefined)).toBe(
      "in-flight",
    );
    expect(issueRailNodeState(task("fixing"), undefined)).toBe("in-flight");
    expect(issueRailNodeState(task("done"), undefined)).toBe("merged");
  });

  it("maps story and epic derived statuses", () => {
    expect(
      issueRailNodeState(story(), {
        blocked: false,
        storyStatus: "in-progress",
      }),
    ).toBe("in-flight");
    expect(
      issueRailNodeState(story(), { blocked: false, storyStatus: "merged" }),
    ).toBe("merged");
    expect(
      issueRailNodeState(epic(), { blocked: false, epicStatus: "done" }),
    ).toBe("merged");
    expect(
      issueRailNodeState(epic(), { blocked: false, epicStatus: "todo" }),
    ).toBe("ready");
    expect(
      issueRailNodeState(idea(), { blocked: false, ideaStatus: "planning" }),
    ).toBe("in-flight");
    expect(
      issueRailNodeState(idea(), {
        blocked: false,
        ideaStatus: "awaiting-direction",
      }),
    ).toBe("needs-attention");
    expect(
      issueRailNodeState(idea(), { blocked: false, ideaStatus: "planned" }),
    ).toBe("needs-attention");
  });

  it("maps blocked ahead of in-flight", () => {
    const state: DerivedState = {
      blocked: true,
      storyStatus: "in-progress",
    };
    expect(issueRailNodeState(story(), state)).toBe("blocked");
  });

  it("maps needs-attention ahead of blocked and in-flight", () => {
    expect(
      issueRailNodeState(task("in-progress", { needsAttention: true }), {
        blocked: true,
      }),
    ).toBe("needs-attention");
    expect(
      issueRailNodeState(story({ needsAttention: true }), {
        blocked: true,
        storyStatus: "in-progress",
      }),
    ).toBe("needs-attention");
  });
});

import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { issueRailNodeState } from "./rail-state";
import { buildTreeRowIndexes } from "./tree-row-indexes";

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
    commits: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
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
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
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
    order: 0,
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
    order: 0,
    ...timestamps,
    ...extras,
  };
}

describe("issueRailNodeState", () => {
  const emptyIndexes = buildTreeRowIndexes([]);

  it("maps ready / in-flight / merged for tasks", () => {
    expect(issueRailNodeState(task("todo"), undefined, emptyIndexes)).toBe(
      "ready",
    );
    expect(
      issueRailNodeState(task("in-progress"), undefined, emptyIndexes),
    ).toBe("in-flight");
    expect(issueRailNodeState(task("done"), undefined, emptyIndexes)).toBe(
      "merged",
    );
  });

  it("maps story and epic derived statuses", () => {
    expect(
      issueRailNodeState(
        story(),
        {
          blocked: false,
          storyStatus: "in-progress",
        },
        emptyIndexes,
      ),
    ).toBe("in-flight");
    expect(
      issueRailNodeState(
        story(),
        { blocked: false, storyStatus: "merged" },
        emptyIndexes,
      ),
    ).toBe("merged");
    expect(
      issueRailNodeState(
        epic(),
        { blocked: false, epicStatus: "done" },
        emptyIndexes,
      ),
    ).toBe("merged");
    expect(
      issueRailNodeState(
        epic(),
        { blocked: false, epicStatus: "todo" },
        emptyIndexes,
      ),
    ).toBe("ready");
    expect(
      issueRailNodeState(
        idea(),
        { blocked: false, ideaStatus: "planning" },
        emptyIndexes,
      ),
    ).toBe("in-flight");
    expect(
      issueRailNodeState(
        idea(),
        {
          blocked: false,
          ideaStatus: "awaiting-direction",
        },
        emptyIndexes,
      ),
    ).toBe("needs-attention");
    expect(
      issueRailNodeState(
        idea(),
        {
          blocked: false,
          ideaStatus: "awaiting-approval",
        },
        emptyIndexes,
      ),
    ).toBe("needs-attention");
    expect(
      issueRailNodeState(
        idea(),
        { blocked: false, ideaStatus: "planned" },
        emptyIndexes,
      ),
    ).toBe("needs-attention");
  });

  it("maps blocked ahead of in-flight", () => {
    const state: DerivedState = {
      blocked: true,
      storyStatus: "in-progress",
    };
    expect(issueRailNodeState(story(), state, emptyIndexes)).toBe("blocked");
  });

  it("maps needs-attention ahead of blocked and in-flight", () => {
    expect(
      issueRailNodeState(
        task("in-progress", { needsAttention: true }),
        {
          blocked: true,
        },
        emptyIndexes,
      ),
    ).toBe("needs-attention");
    expect(
      issueRailNodeState(
        story({ needsAttention: true }),
        {
          blocked: true,
          storyStatus: "in-progress",
        },
        emptyIndexes,
      ),
    ).toBe("needs-attention");
  });

  it("maps Ready-to-land Stories after attention and blocked", () => {
    const pr = story({ id: "pr" });
    const manual = story({ id: "manual", mergePolicy: "manual" });
    const done = task("done", { partOf: "manual" });
    const indexes = buildTreeRowIndexes([pr, manual, done]);

    expect(
      issueRailNodeState(pr, { blocked: false, storyStatus: "pr-open" }, indexes),
    ).toBe("ready-to-land");
    expect(
      issueRailNodeState(
        manual,
        { blocked: false, storyStatus: "in-progress", mergePolicy: "manual" },
        indexes,
      ),
    ).toBe("ready-to-land");
    expect(
      issueRailNodeState(
        story({ needsAttention: true }),
        { blocked: false, storyStatus: "pr-open" },
        indexes,
      ),
    ).toBe("needs-attention");
    expect(
      issueRailNodeState(
        pr,
        { blocked: true, storyStatus: "pr-open" },
        indexes,
      ),
    ).toBe("blocked");
    expect(
      issueRailNodeState(
        story({ id: "active" }),
        { blocked: false, storyStatus: "in-progress" },
        buildTreeRowIndexes([story({ id: "active" })]),
      ),
    ).toBe("in-flight");
  });
});

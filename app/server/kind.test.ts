import { describe, expect, it } from "vitest";
import { channelForIssue, offersExportChannel } from "./kind.js";
import type { Issue } from "./schemas.js";

type IssueOf<K extends Issue["kind"]> = Extract<Issue, { kind: K }>;

const base = {
  id: "x",
  title: "X",
  order: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const attention = {
  needsAttention: false,
  attentionReason: null,
  archived: false,
} as const;

function project(): IssueOf<"project"> {
  return {
    ...base,
    kind: "project",
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
  };
}

function idea(partOf: string): IssueOf<"idea"> {
  return { ...base, kind: "idea", partOf, archived: false };
}

function epic(
  partOf: string,
  extra: Partial<IssueOf<"epic">> = {},
): IssueOf<"epic"> {
  return { ...base, ...attention, kind: "epic", partOf, blockedBy: [], ...extra };
}

function story(partOf: string): IssueOf<"story"> {
  return {
    ...base,
    ...attention,
    kind: "story",
    partOf,
    merged: false,
    reviewedTasks: [],
  };
}

function task(partOf: string): IssueOf<"task"> {
  return {
    ...base,
    ...attention,
    kind: "task",
    partOf,
    status: "todo",
    commits: [],
  };
}

describe("channelForIssue", () => {
  it("offers no channel on a Project", () => {
    const issue = project();
    expect(channelForIssue(issue)).toBeUndefined();
  });

  it("offers planning on an Idea", () => {
    const issue = idea("issue-tracker");
    expect(channelForIssue(issue)).toBe("planning");
  });

  it("offers implementing on an Epic", () => {
    const issue = epic("issue-tracker");
    expect(channelForIssue(issue)).toBe("implementing");
  });

  it("offers implementing on a project-level Story", () => {
    const issue = story("issue-tracker");
    expect(channelForIssue(issue, "project")).toBe("implementing");
  });

  it("offers no channel on an Epic-child Story", () => {
    const issue = story("issue-workflow-channels");
    expect(channelForIssue(issue, "epic")).toBeUndefined();
  });

  it("offers no channel on a Task", () => {
    const issue = task("anchor-sessions-to-issue-channels");
    expect(channelForIssue(issue)).toBeUndefined();
  });
});

describe("offersExportChannel", () => {
  it("offers export on an unarchived Epic beside implementing", () => {
    const issue = epic("issue-tracker");
    expect(offersExportChannel(issue)).toBe(true);
    expect(channelForIssue(issue)).toBe("implementing");
  });

  it("refuses export on an archived Epic", () => {
    const issue = epic("issue-tracker", { archived: true });
    expect(offersExportChannel(issue)).toBe(false);
    expect(channelForIssue(issue)).toBe("implementing");
  });

  it("offers export on an unarchived project-level Story", () => {
    const issue = story("issue-tracker");
    expect(offersExportChannel(issue, "project")).toBe(true);
  });

  it("refuses export on an Epic-child Story, Idea, and Task", () => {
    const epicChild = story("epic-1");
    const projectIdea = idea("issue-tracker");
    const storyTask = task("story-1");
    expect(offersExportChannel(epicChild, "epic")).toBe(false);
    expect(offersExportChannel(projectIdea)).toBe(false);
    expect(offersExportChannel(storyTask)).toBe(false);
  });
});

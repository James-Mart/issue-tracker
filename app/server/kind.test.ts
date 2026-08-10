import { describe, expect, it } from "vitest";
import { channelForIssue } from "./kind.js";
import type { Issue } from "./schemas.js";

const base = {
  id: "x",
  title: "X",
  order: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

describe("channelForIssue", () => {
  it("offers no channel on a Project", () => {
    const issue = { ...base, kind: "project" } satisfies Issue;
    expect(channelForIssue(issue)).toBeUndefined();
  });

  it("offers planning on an Idea", () => {
    const issue = {
      ...base,
      kind: "idea",
      partOf: "issue-tracker",
    } satisfies Issue;
    expect(channelForIssue(issue)).toBe("planning");
  });

  it("offers implementing on an Epic", () => {
    const issue = {
      ...base,
      kind: "epic",
      partOf: "issue-tracker",
    } satisfies Issue;
    expect(channelForIssue(issue)).toBe("implementing");
  });

  it("offers implementing on a project-level Story", () => {
    const issue = {
      ...base,
      kind: "story",
      partOf: "issue-tracker",
    } satisfies Issue;
    expect(channelForIssue(issue, "project")).toBe("implementing");
  });

  it("offers no channel on an Epic-child Story", () => {
    const issue = {
      ...base,
      kind: "story",
      partOf: "issue-workflow-channels",
    } satisfies Issue;
    expect(channelForIssue(issue, "epic")).toBeUndefined();
  });

  it("offers no channel on a Task", () => {
    const issue = {
      ...base,
      kind: "task",
      partOf: "anchor-sessions-to-issue-channels",
    } satisfies Issue;
    expect(channelForIssue(issue)).toBeUndefined();
  });
});

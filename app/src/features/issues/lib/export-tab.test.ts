import { describe, expect, it } from "vitest";
import type { Issue } from "@server/schemas";
import {
  exportDraftCount,
  exportLaunchEligible,
  exportOverviewPhase,
  exportSessionFailed,
  exportTabIncluded,
  exportTabVisible,
  exportTranscriptChrome,
  projectWorkspaceSet,
} from "./export-tab";

const base = {
  id: "auth",
  title: "Auth hardening",
  order: 0,
  archived: false,
  needsAttention: false,
  attentionReason: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;

const epic = {
  ...base,
  kind: "epic",
  partOf: "issue-tracker",
  blockedBy: [],
} satisfies Issue;

const projectStory = {
  ...base,
  kind: "story",
  partOf: "issue-tracker",
  merged: false,
  reviewedTasks: [],
} satisfies Issue;

const epicStory = {
  ...base,
  id: "child",
  kind: "story",
  partOf: "auth",
  merged: false,
  reviewedTasks: [],
} satisfies Issue;

describe("exportLaunchEligible", () => {
  it("allows an unarchived Epic or project-level Story with a workspace", () => {
    expect(exportLaunchEligible(epic, undefined, true)).toBe(true);
    expect(exportLaunchEligible(projectStory, "project", true)).toBe(true);
  });

  it("hides archived roots, missing workspace, and Epic-child Stories", () => {
    expect(
      exportLaunchEligible({ ...epic, archived: true }, undefined, true),
    ).toBe(false);
    expect(exportLaunchEligible(epic, undefined, false)).toBe(false);
    expect(exportLaunchEligible(epicStory, "epic", true)).toBe(false);
    expect(projectWorkspaceSet([], "issue-tracker")).toBe(false);
    expect(
      projectWorkspaceSet(
        [{ id: "issue-tracker", kind: "project", workspace: "  " }],
        "issue-tracker",
      ),
    ).toBe(false);
    expect(
      projectWorkspaceSet(
        [{ id: "issue-tracker", kind: "project", workspace: "/tmp/repo" }],
        "issue-tracker",
      ),
    ).toBe(true);
  });
});

describe("export session outcome", () => {
  it("treats an error event or a trailing error tool as failure", () => {
    expect(exportSessionFailed([])).toBe(false);
    expect(exportSessionFailed([{ type: "assistant" }])).toBe(false);
    expect(exportSessionFailed([{ type: "error" }])).toBe(true);
    expect(
      exportSessionFailed([{ type: "tool_call", status: "error" }]),
    ).toBe(true);
    expect(
      exportSessionFailed([
        { type: "tool_call", status: "error" },
        { type: "tool_call", status: "completed" },
      ]),
    ).toBe(false);
    expect(
      exportSessionFailed([
        { type: "error" },
        { type: "prompt" },
        { type: "assistant" },
      ]),
    ).toBe(false);
  });
});

describe("export tab visibility", () => {
  const visible = {
    eligible: true,
    liveRun: false,
    latestFailed: false,
    hasDrafts: false,
  };

  it("stays idle until a start, including a completed session whose drafts were deleted", () => {
    expect(exportOverviewPhase(visible)).toBe("idle");
    expect(exportTabVisible(visible)).toBe(false);
  });

  it("stays up for a live run, a failed first run with no drafts, or any draft", () => {
    expect(exportTabVisible({ ...visible, liveRun: true })).toBe(true);
    expect(exportOverviewPhase({ ...visible, liveRun: true })).toBe("running");
    expect(exportTabVisible({ ...visible, latestFailed: true })).toBe(true);
    expect(exportOverviewPhase({ ...visible, latestFailed: true })).toBe(
      "failed",
    );
    expect(exportTabVisible({ ...visible, hasDrafts: true })).toBe(true);
    expect(exportOverviewPhase({ ...visible, hasDrafts: true })).toBe(
      "drafts-ready",
    );
    expect(
      exportOverviewPhase({
        ...visible,
        liveRun: true,
        hasDrafts: true,
      }),
    ).toBe("running");
  });

  it("hides the tab when the root is not eligible", () => {
    expect(
      exportTabVisible({ ...visible, eligible: false, hasDrafts: true }),
    ).toBe(false);
    expect(exportOverviewPhase({ ...visible, eligible: false })).toBe(
      "hidden",
    );
  });

  it("counts reserved draft names only", () => {
    expect(
      exportDraftCount([
        "notes.md",
        "github-export-auth.md",
        "github-export-session.md",
      ]),
    ).toBe(2);
  });
});

describe("exportTabIncluded", () => {
  it("keeps a deep link while presence is loading", () => {
    expect(exportTabIncluded("loading", "export")).toBe(true);
    expect(exportTabIncluded("loading", "implementing")).toBe(false);
    expect(exportTabIncluded(false, "export")).toBe(false);
    expect(exportTabIncluded(true, null)).toBe(true);
  });
});

describe("exportTranscriptChrome", () => {
  it("disables the composer during the first rewrite and offers Retry after failure", () => {
    expect(
      exportTranscriptChrome({
        activeRun: true,
        hasDrafts: false,
        latestFailed: false,
      }),
    ).toEqual({ composerDisabled: true, showRetry: false });
    expect(
      exportTranscriptChrome({
        activeRun: false,
        hasDrafts: false,
        latestFailed: true,
      }),
    ).toEqual({ composerDisabled: false, showRetry: true });
    expect(
      exportTranscriptChrome({
        activeRun: true,
        hasDrafts: true,
        latestFailed: false,
      }),
    ).toEqual({ composerDisabled: false, showRetry: false });
  });
});

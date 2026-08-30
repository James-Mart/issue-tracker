import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  cockpitLaunchAckIsStale,
  cockpitLaunchFaultMessage,
  overlayCockpitLaunchAck,
} from "./cockpit-launch-sync";

const t0 = "2026-07-01T00:00:00.000Z";

function epic(id: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function story(id: string): IssueRecord {
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
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

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

describe("cockpitLaunchFaultMessage", () => {
  it("names the issue and the failed work-loop start", () => {
    expect(cockpitLaunchFaultMessage("Auth hardening", "work")).toBe(
      "Auth hardening — Work loop didn't start. Start work again.",
    );
  });

  it("names the issue and the failed planning start", () => {
    expect(cockpitLaunchFaultMessage("Offline sync", "planning")).toBe(
      "Offline sync — Planning session didn't start. Begin planning again.",
    );
  });
});

describe("overlayCockpitLaunchAck", () => {
  it("marks a ready Epic in-progress with liveRun", () => {
    const issues = [epic("auth")];
    const derived: Record<string, DerivedState> = {
      auth: { blocked: false, epicStatus: "todo" },
    };
    expect(
      overlayCockpitLaunchAck(derived, issues, {
        issueId: "auth",
        kind: "work",
      }).auth,
    ).toEqual({
      blocked: false,
      epicStatus: "in-progress",
      liveRun: true,
    });
  });

  it("marks a ready project-level Story in-progress with liveRun", () => {
    const issues = [story("solo")];
    const derived: Record<string, DerivedState> = {
      solo: { blocked: false, storyStatus: "not-started" },
    };
    expect(
      overlayCockpitLaunchAck(derived, issues, {
        issueId: "solo",
        kind: "work",
      }).solo,
    ).toEqual({
      blocked: false,
      storyStatus: "in-progress",
      liveRun: true,
    });
  });

  it("marks a captured Idea planning with liveRun", () => {
    const issues = [idea("offline")];
    const derived: Record<string, DerivedState> = {
      offline: { blocked: false, ideaStatus: "captured" },
    };
    expect(
      overlayCockpitLaunchAck(derived, issues, {
        issueId: "offline",
        kind: "planning",
      }).offline,
    ).toEqual({
      blocked: false,
      ideaStatus: "planning",
      liveRun: true,
    });
  });

  it("does not rewrite a nested Story when overlaying an Epic", () => {
    const issues = [epic("auth"), { ...story("nested"), partOf: "auth" }];
    const derived: Record<string, DerivedState> = {
      auth: { blocked: false, epicStatus: "todo" },
      nested: { blocked: false, storyStatus: "not-started" },
    };
    const next = overlayCockpitLaunchAck(derived, issues, {
      issueId: "auth",
      kind: "work",
    });
    expect(next.nested).toEqual({
      blocked: false,
      storyStatus: "not-started",
    });
  });
});

describe("cockpitLaunchAckIsStale", () => {
  it("keeps the ack on the same derived object and drops it on a later payload", () => {
    const first = { auth: { blocked: false, epicStatus: "todo" as const } };
    expect(cockpitLaunchAckIsStale(undefined, first)).toBe(false);
    expect(cockpitLaunchAckIsStale(first, first)).toBe(false);
    expect(
      cockpitLaunchAckIsStale(first, {
        auth: { blocked: false, epicStatus: "todo" },
      }),
    ).toBe(true);
  });
});

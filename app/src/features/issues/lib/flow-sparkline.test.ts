import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { flowItemSparkline } from "./flow-sparkline";

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

function epic(id: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    blockedBy: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

function item(issue: IssueRecord, state?: DerivedState) {
  return { issue, state };
}

describe("flowItemSparkline", () => {
  it("maps in-flight and merged Stories, and skips Ready", () => {
    expect(
      flowItemSparkline(
        item(story("ready"), { blocked: false, storyStatus: "not-started" }),
      ),
    ).toBeUndefined();

    const flying = flowItemSparkline(
      item(story("fly"), { blocked: false, storyStatus: "in-progress" }),
    );
    expect(flying?.map((stage) => [stage.name, stage.tone])).toEqual([
      ["not started", "done"],
      ["in progress", "current"],
      ["PR open", "idle"],
      ["merged", "idle"],
    ]);

    const landed = flowItemSparkline(
      item(story("land"), { blocked: false, storyStatus: "merged" }),
    );
    expect(landed?.every((stage) => stage.tone === "done")).toBe(true);
  });

  it("maps in-flight Epics and planning Ideas only", () => {
    expect(
      flowItemSparkline(
        item(epic("ready"), { blocked: false, epicStatus: "todo" }),
      ),
    ).toBeUndefined();

    expect(
      flowItemSparkline(
        item(epic("fly"), { blocked: false, epicStatus: "in-progress" }),
      )?.map((stage) => stage.tone),
    ).toEqual(["done", "current", "idle"]);

    expect(
      flowItemSparkline(
        item(idea("plan"), { blocked: false, ideaStatus: "planning" }),
      )?.map((stage) => [stage.name, stage.tone]),
    ).toEqual([
      ["captured", "done"],
      ["planning", "current"],
      ["planned", "idle"],
    ]);

    expect(
      flowItemSparkline(
        item(idea("stall"), {
          blocked: false,
          ideaStatus: "awaiting-direction",
        }),
      ),
    ).toBeUndefined();
  });
});

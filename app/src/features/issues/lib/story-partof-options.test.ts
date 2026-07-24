import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { storyPartOfOptions } from "./story-partof-options";

const AT = "2026-07-09T14:00:00.000Z";

function project(id: string, order = 0): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    order,
    createdAt: AT,
    updatedAt: AT,
  };
}

function epic(id: string, partOf: string, order = 0): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
    order,
    blockedBy: [],
    needsAttention: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

function story(
  id: string,
  partOf: string,
  order = 0,
): Extract<IssueRecord, { kind: "story" }> {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order,
    merged: false,
    needsAttention: false,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe("storyPartOfOptions", () => {
  it("returns the containing project and its epics, ordered", () => {
    const solo = story("solo", "p", 3);
    const issues: IssueRecord[] = [
      project("p", 0),
      project("other", 1),
      epic("e1", "p", 1),
      epic("e2", "p", 2),
      epic("foreign", "other", 0),
      solo,
      story("under-e1", "e1", 0),
    ];

    expect(storyPartOfOptions(solo, issues).map((i) => i.id)).toEqual([
      "p",
      "e1",
      "e2",
    ]);
  });

  it("includes the current partOf when it is not otherwise listed", () => {
    const underP = story("under-p", "stale-epic", 2);
    const issues: IssueRecord[] = [
      project("p", 0),
      epic("e1", "p", 1),
      underP,
      {
        id: "stale-epic",
        kind: "idea",
        title: "Stale",
        partOf: "p",
        order: 3,
        createdAt: AT,
        updatedAt: AT,
      },
    ];

    expect(storyPartOfOptions(underP, issues).map((i) => i.id)).toEqual([
      "p",
      "e1",
      "stale-epic",
    ]);
  });
});

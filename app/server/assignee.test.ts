import { describe, expect, it } from "vitest";
import { assigneeOf } from "./assignee.js";
import type { IssueRecord } from "./schemas.js";

const AT = "2026-07-10T14:00:00.000Z";

function commit(assignee?: string): IssueRecord {
  return {
    id: "c1",
    kind: "task",
    title: "C1",
    partOf: "a",
    status: "todo",
    commits: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...(assignee !== undefined ? { assignee } : {}),
  };
}

describe("assigneeOf", () => {
  it.each<{ name: string; issue: IssueRecord }>([
    {
      name: "project",
      issue: {
        id: "p",
        kind: "project",
        title: "P",
        trunk: "main",
        mergePolicy: "manual",
        maxImplementingRuns: 1,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
    },
    {
      name: "epic",
      issue: {
        id: "e",
        kind: "epic",
        title: "E",
        partOf: "p",
        blockedBy: [],
        needsAttention: false,
        attentionReason: null,
        archived: false,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
    },
    {
      name: "story",
      issue: {
        id: "s",
        kind: "story",
        title: "S",
        partOf: "e",
        merged: false,
        reviewedTasks: [],
        needsAttention: false,
        attentionReason: null,
        archived: false,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
    },
    {
      name: "idea",
      issue: {
        id: "i",
        kind: "idea",
        title: "I",
        partOf: "p",
        archived: false,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      },
    },
  ])("returns undefined for $name", ({ issue }) => {
    expect(assigneeOf(issue)).toBeUndefined();
  });

  it("returns undefined when assignee is absent", () => {
    expect(assigneeOf(commit())).toBeUndefined();
  });

  it("returns undefined for whitespace-only assignee", () => {
    expect(assigneeOf(commit("   "))).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(assigneeOf(commit("  composer-2.5  "))).toBe("composer-2.5");
  });
});

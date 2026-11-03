import { describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { linkedRootsForOutline } from "./outline-links";

const t0 = "2026-08-01T00:00:00.000Z";

function project(): IssueRecord {
  return {
    id: "proj",
    kind: "project",
    title: "Proj",
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
  };
}

function epic(
  id: string,
  order: number,
  outline?: string,
  version = 1,
  archived = false,
): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "proj",
    blockedBy: [],
    order,
    archived,
    needsAttention: false,
    attentionReason: null,
    createdAt: t0,
    updatedAt: t0,
    ...(outline ? { sourceOutline: { outline, version } } : {}),
  };
}

function story(
  id: string,
  partOf: string,
  order: number,
  outline?: string,
  extra: { stackedOn?: string; archived?: boolean; version?: number } = {},
): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order,
    archived: extra.archived ?? false,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    createdAt: t0,
    updatedAt: t0,
    ...(extra.stackedOn ? { stackedOn: extra.stackedOn } : {}),
    ...(outline
      ? { sourceOutline: { outline, version: extra.version ?? 2 } }
      : {}),
  };
}

function task(id: string, outline: string): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf: "root-story",
    status: "todo",
    commits: [],
    order: 0,
    archived: false,
    needsAttention: false,
    attentionReason: null,
    createdAt: t0,
    updatedAt: t0,
    sourceOutline: { outline, version: 1 },
  };
}

const derived: Record<string, DerivedState> = {
  "epic-old": { blocked: false, behind: true },
  "root-story": { blocked: false, behind: false },
};

describe("linkedRootsForOutline", () => {
  const issues: IssueRecord[] = [
    project(),
    epic("epic-old", 2, "outline-a", 1),
    epic("epic-other", 0, "outline-b", 1),
    epic("epic-archived", 3, "outline-a", 1, true),
    story("root-story", "proj", 1, "outline-a"),
    story("nested", "epic-old", 0, "outline-a"),
    story("stacked", "proj", 4, "outline-a", { stackedOn: "root-story" }),
    task("task-a", "outline-a"),
  ];

  it("keeps root epics and project-level stories, in board order", () => {
    const roots = linkedRootsForOutline(issues, derived, "outline-a", false);
    expect(roots.map((root) => root.id)).toEqual(["root-story", "epic-old"]);
    expect(roots.map((root) => [root.kind, root.version, root.behind])).toEqual([
      ["story", 2, false],
      ["epic", 1, true],
    ]);
  });
});

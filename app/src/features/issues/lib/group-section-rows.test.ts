import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import type { FlowItem } from "./flow";
import { groupSectionRows } from "./group-section-rows";

const t0 = "2026-07-01T00:00:00.000Z";

function epic(id: string, title: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title,
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

function story(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: false,
    reviewedTasks: [],
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

function row(issue: IssueRecord): FlowItem {
  return { issue, state: undefined };
}

describe("groupSectionRows", () => {
  const claims = epic("claims", "AuthDelegate stack");
  const byId = new Map<string, IssueRecord>([[claims.id, claims]]);

  it("heads the same epic with its card in one section and a title in the other", () => {
    const card = row(claims);
    const flagged = row(story("flagged", "claims"));
    const quiet = row(story("quiet", "claims"));

    expect(groupSectionRows([flagged, card], byId)).toEqual([
      { head: { kind: "card", epicId: "claims" }, items: [card, flagged] },
    ]);
    expect(groupSectionRows([quiet], byId)).toEqual([
      { head: { kind: "title", epicId: "claims" }, items: [quiet] },
    ]);
  });
});

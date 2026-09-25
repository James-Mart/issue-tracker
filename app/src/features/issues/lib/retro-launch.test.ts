import { describe, expect, it } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { skillPath } from "@/lib/plugin-paths";
import {
  implementingRetroWorkRoot,
  retroSessionMessage,
} from "./retro-launch";

describe("retroSessionMessage", () => {
  it("names the work root and issue-tracker-retro skill", () => {
    expect(retroSessionMessage("ship-it", "Ship it")).toBe(
      `Run retro on ship-it (Ship it) in the issue tracker using the issue-tracker-retro skill. Read ${skillPath("issue-tracker-retro")} and follow it.`,
    );
  });
});

describe("implementingRetroWorkRoot", () => {
  const epic: IssueDetail = {
    kind: "epic",
    id: "ship-it",
    title: "Ship it",
    partOf: "platform",
    blockedBy: [],
    order: 0,
    archived: false,
    needsAttention: false,
    attentionReason: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    description: "",
    version: "1",
  };

  it("returns the anchored Epic on an implementing channel", () => {
    expect(
      implementingRetroWorkRoot("implementing", epic, undefined),
    ).toEqual({ id: "ship-it", title: "Ship it" });
  });

  it("returns undefined on a planning channel", () => {
    expect(
      implementingRetroWorkRoot("planning", epic, undefined),
    ).toBeUndefined();
  });
});

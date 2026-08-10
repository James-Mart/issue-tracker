import { describe, expect, it } from "vitest";
import {
  implementingRetroWorkRoot,
  retroSessionMessage,
} from "./retro-launch";

describe("retroSessionMessage", () => {
  it("names the work root and issue-tracker-retro skill", () => {
    expect(retroSessionMessage("ship-it", "Ship it")).toBe(
      "Run retro on ship-it (Ship it) in the issue tracker using the issue-tracker-retro skill.",
    );
  });
});

describe("implementingRetroWorkRoot", () => {
  const epic = {
    kind: "epic" as const,
    id: "ship-it",
    title: "Ship it",
    partOf: "platform",
    status: "open" as const,
    order: 0,
    archived: false,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
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

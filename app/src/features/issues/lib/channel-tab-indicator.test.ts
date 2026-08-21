import { describe, expect, it } from "vitest";
import { channelTabIndicator } from "./channel-tab-indicator";

describe("channelTabIndicator", () => {
  it("shows neither treatment when the channel has no session", () => {
    expect(channelTabIndicator(false, true, true)).toBeNull();
    expect(channelTabIndicator(false, false, true)).toBeNull();
  });

  it("shows the active-run dot while a run is in flight", () => {
    expect(channelTabIndicator(true, true, false)).toBe("active-run");
    expect(channelTabIndicator(true, true, true)).toBe("active-run");
  });

  it("takes awaiting-human when idle and the session list marks it", () => {
    expect(channelTabIndicator(true, false, true)).toBe("awaiting-human");
  });

  it("clears the accent when the session is idle and not awaiting", () => {
    expect(channelTabIndicator(true, false, false)).toBeNull();
  });

  it("ignores archived/no-session the same as an empty idle channel", () => {
    // Callers pass hasSession=false when currentChannelSession finds none
    // (including when every session is archived).
    expect(channelTabIndicator(false, false, true)).toBeNull();
  });

  it("never shows the dot and the accent together", () => {
    const cases: Array<{
      hasSession: boolean;
      activeRun: boolean;
      awaitingHuman: boolean;
    }> = [
      { hasSession: false, activeRun: false, awaitingHuman: false },
      { hasSession: false, activeRun: true, awaitingHuman: true },
      { hasSession: true, activeRun: true, awaitingHuman: false },
      { hasSession: true, activeRun: true, awaitingHuman: true },
      { hasSession: true, activeRun: false, awaitingHuman: true },
      { hasSession: true, activeRun: false, awaitingHuman: false },
    ];
    for (const c of cases) {
      const indicator = channelTabIndicator(
        c.hasSession,
        c.activeRun,
        c.awaitingHuman,
      );
      expect(indicator === "active-run" && indicator === "awaiting-human").toBe(
        false,
      );
      expect(
        new Set(
          [indicator].filter((value): value is NonNullable<typeof value> =>
            value != null,
          ),
        ).size,
      ).toBeLessThanOrEqual(1);
    }
  });
});

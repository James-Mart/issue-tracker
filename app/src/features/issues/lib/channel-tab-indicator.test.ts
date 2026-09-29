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
});

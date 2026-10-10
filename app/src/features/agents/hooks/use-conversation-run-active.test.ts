import { describe, expect, it } from "vitest";
import { resolveRunActive } from "./use-conversation-run-active";

describe("resolveRunActive", () => {
  it("clears when a finished frame arrives on the stream", () => {
    expect(
      resolveRunActive({ loaded: true, active: true }, false),
    ).toBe(false);
  });

  it("uses a refreshed seed after reconnect clears a stale stream flag", () => {
    expect(resolveRunActive({ loaded: true, active: false }, null)).toBe(
      false,
    );
  });
});

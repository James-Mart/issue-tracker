import { describe, expect, it } from "vitest";
import {
  resolveRunActive,
  runActiveFromFrame,
} from "./use-conversation-run-active";

describe("runActiveFromFrame", () => {
  it("is true for started and false for finished", () => {
    expect(runActiveFromFrame("started")).toBe(true);
    expect(runActiveFromFrame("finished")).toBe(false);
  });
});

describe("resolveRunActive", () => {
  it("reports a run active on mount from the server seed", () => {
    expect(
      resolveRunActive({ loaded: true, active: true }, null),
    ).toBe(true);
  });

  it("stays active while the stream reports started and goes quiet", () => {
    expect(
      resolveRunActive({ loaded: true, active: false }, true),
    ).toBe(true);
  });

  it("clears when a finished frame arrives on the stream", () => {
    expect(
      resolveRunActive({ loaded: true, active: true }, false),
    ).toBe(false);
  });

  it("waits for the seed before showing active when no stream frame yet", () => {
    expect(resolveRunActive({ loaded: false, active: true }, null)).toBe(
      false,
    );
    expect(resolveRunActive({ loaded: true, active: true }, null)).toBe(true);
  });

  it("uses a refreshed seed after reconnect clears a stale stream flag", () => {
    expect(resolveRunActive({ loaded: true, active: false }, null)).toBe(
      false,
    );
  });
});

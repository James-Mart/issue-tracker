import { describe, expect, it } from "vitest";
import { parseTranscriptEvent, parseTranscriptEventInput } from "./schemas";

describe("host_crash_recovery transcript event", () => {
  it("round-trips a host-crash recovery record", () => {
    const input = parseTranscriptEventInput({
      type: "host_crash_recovery",
      message: "The previous turn was cut off because the host process died.",
    });
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    const stored = parseTranscriptEvent({
      ...input.input,
      at: "2026-07-25T12:00:00.000Z",
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.event).toMatchObject({
      type: "host_crash_recovery",
      message: "The previous turn was cut off because the host process died.",
    });
  });
});

import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { channelTabIndicator } from "./channel-tab-indicator";

const at = "2026-08-10T00:00:00.000Z";

function prompt(text = "Hello"): TranscriptEvent {
  return { type: "prompt", text, at };
}

function assistant(text = "Reply"): TranscriptEvent {
  return { type: "assistant", text, at };
}

function error(message = "boom"): TranscriptEvent {
  return { type: "error", message, at };
}

describe("channelTabIndicator", () => {
  it("shows neither treatment when the channel has no session", () => {
    expect(channelTabIndicator(false, true, [assistant()])).toBeNull();
    expect(channelTabIndicator(false, false, [assistant()])).toBeNull();
  });

  it("shows the active-run dot while a run is in flight", () => {
    expect(channelTabIndicator(true, true, [prompt(), assistant()])).toBe(
      "active-run",
    );
    expect(channelTabIndicator(true, true, [prompt()])).toBe("active-run");
  });

  it("takes awaiting-human after an idle assistant turn", () => {
    expect(
      channelTabIndicator(true, false, [prompt(), assistant("Question?")]),
    ).toBe("awaiting-human");
  });

  it("takes awaiting-human after an errored run", () => {
    expect(channelTabIndicator(true, false, [prompt(), error()])).toBe(
      "awaiting-human",
    );
  });

  it("clears the accent when the human's prompt is the last turn", () => {
    expect(
      channelTabIndicator(true, false, [
        prompt("first"),
        assistant(),
        prompt("reply"),
      ]),
    ).toBeNull();
  });

  it("ignores archived/no-session the same as an empty idle channel", () => {
    // Callers pass hasSession=false when currentChannelSession finds none
    // (including when every session is archived).
    expect(channelTabIndicator(false, false, [assistant()])).toBeNull();
  });

  it("never shows the dot and the accent together", () => {
    const cases: Array<{
      hasSession: boolean;
      runActive: boolean;
      events: TranscriptEvent[];
    }> = [
      { hasSession: false, runActive: false, events: [] },
      { hasSession: false, runActive: true, events: [assistant()] },
      { hasSession: true, runActive: true, events: [assistant()] },
      { hasSession: true, runActive: false, events: [assistant()] },
      { hasSession: true, runActive: false, events: [prompt(), error()] },
      { hasSession: true, runActive: true, events: [prompt(), error()] },
      {
        hasSession: true,
        runActive: false,
        events: [prompt(), assistant(), prompt()],
      },
    ];
    for (const c of cases) {
      const indicator = channelTabIndicator(c.hasSession, c.runActive, c.events);
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

  it("skips non-boundary frames when finding the last turn", () => {
    const events: TranscriptEvent[] = [
      prompt(),
      assistant("done"),
      { type: "usage", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, at },
      { type: "thinking", text: "…", at },
    ];
    expect(channelTabIndicator(true, false, events)).toBe("awaiting-human");
  });
});

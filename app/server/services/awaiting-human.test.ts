import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "../schemas.js";
import { awaitingHumanFromTranscript } from "./awaiting-human.js";

const AT = "2026-08-10T12:00:00.000Z";

function event(
  type: TranscriptEvent["type"],
  extra?: Partial<TranscriptEvent>,
): TranscriptEvent {
  return { type, at: AT, ...extra } as TranscriptEvent;
}

describe("awaitingHumanFromTranscript", () => {
  it("is false for an empty transcript", () => {
    expect(awaitingHumanFromTranscript([])).toBe(false);
  });

  it("is false when the last turn-boundary is a prompt", () => {
    expect(
      awaitingHumanFromTranscript([
        event("assistant", { text: "done" }),
        event("prompt", { text: "next" }),
      ]),
    ).toBe(false);
  });

  it("is true when the last turn-boundary is assistant", () => {
    expect(
      awaitingHumanFromTranscript([
        event("prompt", { text: "go" }),
        event("assistant", { text: "ok" }),
      ]),
    ).toBe(true);
  });

  it("is true when the last turn-boundary is error", () => {
    expect(
      awaitingHumanFromTranscript([
        event("prompt", { text: "go" }),
        event("error", { message: "boom" }),
      ]),
    ).toBe(true);
  });

  it("skips non-boundary frames when walking from the end", () => {
    expect(
      awaitingHumanFromTranscript([
        event("prompt", { text: "go" }),
        event("assistant", { text: "ok" }),
        event("thinking", { text: "…" }),
        event("tool_call", {
          id: "t1",
          name: "Read",
          status: "completed",
        }),
      ]),
    ).toBe(true);
  });
});

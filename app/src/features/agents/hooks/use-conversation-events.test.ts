import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { applyTranscriptEvent } from "./use-conversation-events";

function at(
  event: Omit<TranscriptEvent, "at">,
  stamp = "2026-07-24T00:00:00.000Z",
): TranscriptEvent {
  return { ...event, at: stamp } as TranscriptEvent;
}

describe("applyTranscriptEvent", () => {
  it("concatenates consecutive assistant deltas and skips the finalize duplicate", () => {
    let events: TranscriptEvent[] = [];
    events = applyTranscriptEvent(
      events,
      at({ type: "assistant", text: "Hel" }, "t1"),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "assistant", text: "lo" }, "t2"),
    );
    expect(events).toEqual([
      { type: "assistant", text: "Hello", at: "t2" },
    ]);
    events = applyTranscriptEvent(
      events,
      at({ type: "assistant", text: "Hello" }, "t3"),
    );
    expect(events).toEqual([
      { type: "assistant", text: "Hello", at: "t2" },
    ]);
  });

  it("replaces tool_call frames with the same callId", () => {
    let events: TranscriptEvent[] = [
      at({
        type: "tool_call",
        callId: "c1",
        status: "running",
        name: "Shell",
      }),
    ];
    events = applyTranscriptEvent(
      events,
      at({
        type: "tool_call",
        callId: "c1",
        status: "completed",
        name: "Shell",
        result: { ok: true },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_call",
      callId: "c1",
      status: "completed",
      result: { ok: true },
    });
  });

  it("appends other event kinds in order", () => {
    let events: TranscriptEvent[] = [];
    events = applyTranscriptEvent(
      events,
      at({ type: "prompt", text: "hi" }),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "..." }),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "status", status: "running" }),
    );
    expect(events.map((e) => e.type)).toEqual([
      "prompt",
      "thinking",
      "status",
    ]);
  });
});

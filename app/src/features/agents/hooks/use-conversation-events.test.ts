import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import {
  applyTranscriptDelta,
  applyTranscriptEvent,
  mergeTranscriptDeltas,
} from "./use-conversation-events";

function at(
  event: Omit<TranscriptEvent, "at">,
  stamp = "2026-07-24T00:00:00.000Z",
): TranscriptEvent {
  return { ...event, at: stamp } as TranscriptEvent;
}

describe("applyTranscriptEvent", () => {
  it("concatenates consecutive thinking deltas and skips the finalize duplicate", () => {
    let events: TranscriptEvent[] = [];
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "Con", seq: 1 }, "t1"),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "sid", seq: 2 }, "t2"),
    );
    expect(events).toEqual([
      { type: "thinking", text: "Consid", at: "t2", seq: 2 },
    ]);
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "Consid", seq: 3 }, "t3"),
    );
    expect(events).toEqual([
      { type: "thinking", text: "Consid", at: "t2", seq: 2 },
    ]);
  });

  it("starts a new thinking block after an intervening assistant event", () => {
    let events: TranscriptEvent[] = [];
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "first", seq: 1 }, "t1"),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "assistant", text: "reply", seq: 2 }, "t2"),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "second", seq: 3 }, "t3"),
    );
    expect(events).toEqual([
      { type: "thinking", text: "first", at: "t1", seq: 1 },
      { type: "assistant", text: "reply", at: "t2", seq: 2 },
      { type: "thinking", text: "second", at: "t3", seq: 3 },
    ]);
  });

  it("starts a new thinking block after an intervening tool_call event", () => {
    let events: TranscriptEvent[] = [];
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "plan", seq: 1 }, "t1"),
    );
    events = applyTranscriptEvent(
      events,
      at({
        type: "tool_call",
        callId: "c1",
        status: "running",
        name: "Shell",
        seq: 2,
      }),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "reflect", seq: 3 }, "t2"),
    );
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "thinking", text: "plan" });
    expect(events[1]).toMatchObject({ type: "tool_call", callId: "c1" });
    expect(events[2]).toMatchObject({ type: "thinking", text: "reflect" });
  });

  it("concatenates consecutive assistant deltas and skips the finalize duplicate", () => {
    let events: TranscriptEvent[] = [];
    events = applyTranscriptEvent(
      events,
      at({ type: "assistant", text: "Hel", seq: 1 }, "t1"),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "assistant", text: "lo", seq: 2 }, "t2"),
    );
    expect(events).toEqual([
      { type: "assistant", text: "Hello", at: "t2", seq: 2 },
    ]);
    events = applyTranscriptEvent(
      events,
      at({ type: "assistant", text: "Hello", seq: 3 }, "t3"),
    );
    expect(events).toEqual([
      { type: "assistant", text: "Hello", at: "t2", seq: 2 },
    ]);
  });

  it("replaces tool_call frames with the same callId", () => {
    let events: TranscriptEvent[] = [
      at({
        type: "tool_call",
        callId: "c1",
        status: "running",
        name: "Shell",
        seq: 1,
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
        seq: 2,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_call",
      callId: "c1",
      status: "completed",
      result: { ok: true },
      seq: 2,
    });
  });

  it("appends other event kinds in order", () => {
    let events: TranscriptEvent[] = [];
    events = applyTranscriptEvent(
      events,
      at({ type: "prompt", text: "hi", seq: 1 }),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "thinking", text: "...", seq: 2 }),
    );
    events = applyTranscriptEvent(
      events,
      at({ type: "status", status: "running", seq: 3 }),
    );
    expect(events.map((e) => e.type)).toEqual([
      "prompt",
      "thinking",
      "status",
    ]);
  });
});

describe("history seed + stream deltas", () => {
  it("applies catch-up and live deltas on top of a history seed in seq order", () => {
    const seed: TranscriptEvent[] = [
      at({ type: "prompt", text: "go", seq: 1 }),
      at({ type: "assistant", text: "Done", seq: 2 }, "t1"),
    ];

    const events = mergeTranscriptDeltas(seed, [
      at({ type: "assistant", text: " streaming", seq: 3 }, "t2"),
      at({ type: "assistant", text: " more", seq: 4 }, "t3"),
      at({ type: "assistant", text: " now", seq: 5 }, "t4"),
    ]);

    expect(events).toEqual([
      at({ type: "prompt", text: "go", seq: 1 }),
      { type: "assistant", text: "Done streaming more now", at: "t4", seq: 5 },
    ]);
  });

  it("skips duplicate seqs already present in the seed", () => {
    const seed: TranscriptEvent[] = [
      at({ type: "prompt", text: "go", seq: 1 }),
      at({ type: "assistant", text: "live", seq: 2 }, "t1"),
    ];

    expect(
      applyTranscriptDelta(
        seed,
        at({ type: "assistant", text: "duplicate", seq: 2 }, "t2"),
      ),
    ).toEqual(seed);
  });

  it("inserts an out-of-order delta by seq without dropping later events", () => {
    const events = applyTranscriptDelta(
      [
        at({ type: "prompt", text: "go", seq: 1 }),
        at({ type: "assistant", text: "later", seq: 3 }, "t3"),
      ],
      at({ type: "assistant", text: "gap", seq: 2 }, "t2"),
    );

    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events[1]).toMatchObject({ text: "gap", seq: 2 });
  });
});

import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import {
  applyTranscriptDelta,
  applyTranscriptEvent,
  mergeTranscriptDeltas,
} from "./use-conversation-events";

type WithoutAt<T> = T extends unknown ? Omit<T, "at"> : never;

function at(
  event: WithoutAt<TranscriptEvent>,
  stamp = "2026-07-24T00:00:00.000Z",
): TranscriptEvent {
  return { ...event, at: stamp } as TranscriptEvent;
}

describe("applyTranscriptEvent", () => {
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

import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import {
  applyTranscriptEvent,
  beginReplayStaging,
  commitReplayStaging,
  foldStreamTranscriptFrame,
} from "./use-conversation-events";

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

describe("stream replay staging", () => {
  it("folds transcript replay, catch-up, and live frames in emission order", () => {
    let { replaying, replayBuffer } = beginReplayStaging();
    let events: TranscriptEvent[] = [];

    const fold = (event: TranscriptEvent) => {
      ({ replaying, replayBuffer, liveEvents: events } = foldStreamTranscriptFrame(
        replaying,
        replayBuffer,
        events,
        event,
      ));
    };

    fold(at({ type: "prompt", text: "go" }));
    fold(at({ type: "assistant", text: "Done" }, "t1"));
    // catch-up deltas between persisted replay and first ping
    fold(at({ type: "assistant", text: " streaming" }, "t2"));
    fold(at({ type: "assistant", text: " more" }, "t3"));

    const committed = commitReplayStaging(replayBuffer);
    replaying = committed.replaying;
    replayBuffer = committed.replayBuffer;
    events = committed.events;

    fold(at({ type: "assistant", text: " now" }, "t4"));

    expect(events).toEqual([
      at({ type: "prompt", text: "go" }),
      { type: "assistant", text: "Done streaming more now", at: "t4" },
    ]);
  });

  it("buffers pre-open catch-up with replay instead of racing ahead of commit", () => {
    let replaying = false;
    let replayBuffer: TranscriptEvent[] = [];
    let events: TranscriptEvent[] = [
      at({ type: "assistant", text: "stale while disconnected" }, "old"),
    ];

    // Catch-up can arrive before `open`; staging must start at connect().
    ({ replaying, replayBuffer } = beginReplayStaging());

    const fold = (event: TranscriptEvent) => {
      ({ replaying, replayBuffer, liveEvents: events } = foldStreamTranscriptFrame(
        replaying,
        replayBuffer,
        events,
        event,
      ));
    };

    fold(at({ type: "prompt", text: "go" }));
    fold(at({ type: "assistant", text: "live" }, "t1"));
    fold(at({ type: "assistant", text: " delta" }, "t2"));

    const committed = commitReplayStaging(replayBuffer);
    events = committed.events;

    expect(events).toEqual([
      at({ type: "prompt", text: "go" }),
      { type: "assistant", text: "live delta", at: "t2" },
    ]);
    expect(events.some((e) => e.type === "assistant" && e.text.includes("stale"))).toBe(
      false,
    );
  });
});

import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { transcriptScrollerBottomKey } from "./transcript-scroller";

const base: TranscriptEvent[] = [
  { type: "prompt", text: "Hi", at: "t1" },
  { type: "assistant", text: "Hello", at: "t2" },
];

describe("transcriptScrollerBottomKey", () => {
  it("changes when a new event is appended", () => {
    const longer = [
      ...base,
      { type: "assistant", text: "More", at: "t3" } satisfies TranscriptEvent,
    ];
    expect(transcriptScrollerBottomKey(longer)).not.toBe(
      transcriptScrollerBottomKey(base),
    );
  });

  it("changes on in-place assistant delta growth", () => {
    const delta: TranscriptEvent[] = [
      base[0]!,
      { type: "assistant", text: "Hello world", at: "t3" },
    ];
    expect(transcriptScrollerBottomKey(delta)).not.toBe(
      transcriptScrollerBottomKey(base),
    );
    expect(delta.length).toBe(base.length);
  });

  it("changes on in-place tool_call status updates", () => {
    const running: TranscriptEvent[] = [
      ...base,
      {
        type: "tool_call",
        callId: "c1",
        name: "read",
        status: "running",
        args: {},
        at: "t3",
      },
    ];
    const done: TranscriptEvent[] = [
      ...base,
      {
        type: "tool_call",
        callId: "c1",
        name: "read",
        status: "completed",
        args: {},
        result: "file contents",
        at: "t4",
      },
    ];
    expect(transcriptScrollerBottomKey(done)).not.toBe(
      transcriptScrollerBottomKey(running),
    );
    expect(done.length).toBe(running.length);
  });
});

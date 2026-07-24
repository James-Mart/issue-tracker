import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { hasRunningToolCall } from "./use-conversation-run-active";

function at(
  event: Omit<TranscriptEvent, "at">,
  stamp = "2026-07-24T00:00:00.000Z",
): TranscriptEvent {
  return { ...event, at: stamp } as TranscriptEvent;
}

describe("hasRunningToolCall", () => {
  it("is false for an empty or settled transcript", () => {
    expect(hasRunningToolCall([])).toBe(false);
    expect(
      hasRunningToolCall([
        at({ type: "prompt", text: "hi" }),
        at({
          type: "tool_call",
          callId: "c1",
          status: "completed",
          name: "Shell",
        }),
      ]),
    ).toBe(false);
  });

  it("is true while any tool_call is running", () => {
    expect(
      hasRunningToolCall([
        at({
          type: "tool_call",
          callId: "c1",
          status: "running",
          name: "Shell",
        }),
      ]),
    ).toBe(true);
  });
});

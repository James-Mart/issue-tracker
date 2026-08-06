import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { transcriptInfoLine } from "./transcript-rows";

const at = "2026-01-01T00:00:00.000Z";

describe("transcriptInfoLine", () => {
  it("returns null for usage events (header carries cumulative totals)", () => {
    const event: TranscriptEvent = {
      type: "usage",
      at,
      usage: {
        totalTokens: 100,
        inputTokens: 40,
        outputTokens: 60,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
    expect(transcriptInfoLine(event)).toBeNull();
  });

  it("returns null for a bare run-state status without a message", () => {
    const event: TranscriptEvent = {
      type: "status",
      at,
      status: "RUNNING",
    };
    expect(transcriptInfoLine(event)).toBeNull();
  });

  it("renders only the message for status events that carry prose", () => {
    const event: TranscriptEvent = {
      type: "status",
      at,
      status: "FINISHED",
      message: "Waiting for approval",
    };
    expect(transcriptInfoLine(event)).toEqual({
      label: "Status",
      text: "Waiting for approval",
    });
  });

  it("still renders task and request rows", () => {
    expect(
      transcriptInfoLine({
        type: "task",
        at,
        status: "started",
        text: "plan",
      }),
    ).toEqual({ label: "Task", text: "started · plan" });
    expect(
      transcriptInfoLine({ type: "request", at, requestId: "req-1" }),
    ).toEqual({ label: "Request", text: "req-1" });
  });
});

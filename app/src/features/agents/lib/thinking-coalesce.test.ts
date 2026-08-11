import { describe, expect, it } from "vitest";
import type { NestedStep, TranscriptEvent } from "@server/schemas";
import {
  findOpenThinkingIndex,
  isBlankThinkingText,
  isNestedThinkingInterrupt,
  isTopLevelThinkingInterrupt,
} from "./thinking-coalesce";

const at = "2026-07-24T00:00:00.000Z";

describe("thinking-coalesce interrupts", () => {
  it("treats usage, bare status, and subagent_update as non-interrupts", () => {
    const quiet: TranscriptEvent[] = [
      { type: "usage", at, usage: {
        totalTokens: 1,
        inputTokens: 1,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      } },
      { type: "status", at, status: "RUNNING" },
      {
        type: "subagent_update",
        at,
        parentCallId: "c1",
        step: { kind: "liveness", elapsedMs: 1 },
      },
      { type: "thinking", at, text: "x" },
    ];
    for (const event of quiet) {
      expect(isTopLevelThinkingInterrupt(event)).toBe(false);
    }
  });

  it("treats visible transcript rows as interrupts", () => {
    const loud: TranscriptEvent[] = [
      { type: "prompt", at, text: "hi" },
      { type: "assistant", at, text: "yo" },
      { type: "tool_call", at, callId: "c1", status: "running" },
      { type: "task", at, status: "started" },
      { type: "status", at, status: "FINISHED", message: "paused" },
      { type: "request", at, requestId: "r1" },
      { type: "error", at, message: "nope" },
    ];
    for (const event of loud) {
      expect(isTopLevelThinkingInterrupt(event)).toBe(true);
    }
  });

  it("treats nested liveness as non-interrupt and other steps as interrupts", () => {
    expect(
      isNestedThinkingInterrupt({ kind: "liveness", elapsedMs: 3 }),
    ).toBe(false);
    expect(isNestedThinkingInterrupt({ kind: "thinking", text: "a" })).toBe(
      false,
    );
    const loud: NestedStep[] = [
      { kind: "text", text: "out" },
      { kind: "tool_call", callId: "c1", status: "running" },
      { kind: "step", stepId: 1, status: "started" },
    ];
    for (const step of loud) {
      expect(isNestedThinkingInterrupt(step)).toBe(true);
    }
  });

  it("finds open thinking past trailing non-interrupts", () => {
    const events: TranscriptEvent[] = [
      { type: "thinking", at, text: "a" },
      { type: "usage", at, usage: {
        totalTokens: 1,
        inputTokens: 1,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      } },
      { type: "status", at, status: "RUNNING" },
    ];
    expect(
      findOpenThinkingIndex(
        events,
        (e) => e.type === "thinking",
        isTopLevelThinkingInterrupt,
      ),
    ).toBe(0);
  });

  it("omits blank thinking text", () => {
    expect(isBlankThinkingText("")).toBe(true);
    expect(isBlankThinkingText(" \n\t")).toBe(true);
    expect(isBlankThinkingText("x")).toBe(false);
  });
});

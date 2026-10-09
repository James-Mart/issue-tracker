import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AT,
  AT_END,
  AT_LATE,
  delegation,
  loadRunSequence,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  toolCall,
  writeConversation,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("runSequence", () => {
  it("prefers a persisted end over a terminal transcript signal", async () => {
    writeConversation("conv-end-wins", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-research", "running", AT, 1),
        toolCall("call-research", "error", AT_LATE, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-end-wins");

    expect(sequence.condition).toBe("completed");
    expect(sequence.beats).toEqual([
      {
        from: "coordinator",
        to: "research",
        label: "spawn Research",
        startedAt: AT,
        durationMs: Date.parse(AT_END) - Date.parse(AT),
        cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
        kind: "spawn",
        parentCallId: "call-research",
      },
    ]);
  });
});

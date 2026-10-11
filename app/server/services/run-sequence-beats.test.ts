import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AT,
  AT_END,
  delegation,
  loadRunSequence,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  toolCall,
  writeConversation,
  writeRunLiveMarker,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("runSequence", () => {
  it("marks the run failed when the final beat is an error return", async () => {
    writeConversation("conv-terminal-failed", {
      meta: { issueId: "capture", channel: "planning" },
      delegations: [
        delegation({
          delegationId: "del-mockup",
          agentId: "agent-mockup",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-mockup",
          end: { status: "error", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-mockup", "running", AT, 1),
        toolCall("call-mockup", "error", AT_END, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-terminal-failed");

    expect(sequence.condition).toBe("failed");
    expect(sequence).not.toHaveProperty("recoveredErrors");
  });

  it("reports in-flight when delegations are closed but the run-live marker is present", async () => {
    writeConversation("conv-live-marker", {
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
        toolCall("call-research", "completed", AT_END, 2),
      ],
    });
    writeRunLiveMarker("conv-live-marker");

    const runSequence = await loadRunSequence();
    expect(runSequence("conv-live-marker").condition).toBe("in-flight");
  });
});

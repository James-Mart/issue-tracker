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
  writeIssue,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("runSequence", () => {
  it("resolves rootIssue from the earliest delegation issue", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("first-issue", {
      kind: "task",
      title: "First task",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("second-issue", {
      kind: "task",
      title: "Second task",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeConversation("conv-root-issue", {
      meta: {
        channel: "implementing",
        issueId: "first-issue",
        createdAt: AT,
      },
      delegations: [
        delegation({
          delegationId: "del-first",
          agentId: "agent-first",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "first-issue",
          parentCallId: "call-first",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-second",
          agentId: "agent-second",
          role: "validator",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "second-issue",
          parentCallId: "call-second",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-first", "running", AT, 1),
        toolCall("call-first", "completed", AT_END, 2),
        toolCall("call-second", "running", AT_LATE, 3),
        toolCall("call-second", "completed", AT_LATE, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-root-issue");

    expect(sequence.rootIssue).toEqual({
      id: "first-issue",
      kind: "task",
      title: "First task",
      projectId: "platform",
    });
  });
});

import { describe, expect, it } from "vitest";
import type { AgentRun, ConversationStreamEvent } from "@server/schemas";
import {
  applyDelegationEnd,
  applyParentToolCall,
} from "./use-work-root-agent-runs";

const AT = "2026-08-28T12:00:00.000Z";
const AT_END = "2026-08-28T12:00:20.000Z";

function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    delegationId: "del-live",
    agentId: "agent-1",
    role: "implementor",
    model: "composer-2.5",
    issueId: "task-1",
    parentCallId: "call-1",
    conversationId: "conv-1",
    startedAt: AT,
    status: "running",
    isResume: false,
    ...overrides,
  };
}

describe("applyDelegationEnd", () => {
  it("updates status and endedAt for the matching parentCallId", () => {
    const runs = [sampleRun()];
    const event: Extract<ConversationStreamEvent, { type: "delegation_end" }> = {
      type: "delegation_end",
      delegationId: "del-live",
      parentCallId: "call-1",
      status: "completed",
      endedAt: AT_END,
      at: AT_END,
      seq: 12,
    };
    const next = applyDelegationEnd(runs, event);
    expect(next[0]).toMatchObject({
      status: "completed",
      endedAt: AT_END,
    });
  });

  it("leaves unrelated runs unchanged", () => {
    const runs = [sampleRun({ parentCallId: "call-other" })];
    const event: Extract<ConversationStreamEvent, { type: "delegation_end" }> = {
      type: "delegation_end",
      delegationId: "del-live",
      parentCallId: "call-1",
      status: "completed",
      endedAt: AT_END,
      at: AT_END,
      seq: 12,
    };
    expect(applyDelegationEnd(runs, event)).toEqual(runs);
  });
});

describe("applyParentToolCall", () => {
  it("does not update status or endedAt on a terminal tool_call", () => {
    const runs = [sampleRun()];
    const event: Extract<ConversationStreamEvent, { type: "tool_call" }> = {
      type: "tool_call",
      callId: "call-1",
      name: "Task",
      status: "completed",
      at: AT_END,
      seq: 12,
    };
    expect(applyParentToolCall(runs, event)).toEqual(runs);
  });

  it("still updates status for a non-terminal tool_call", () => {
    const runs = [sampleRun()];
    const event: Extract<ConversationStreamEvent, { type: "tool_call" }> = {
      type: "tool_call",
      callId: "call-1",
      name: "Task",
      status: "running",
      at: AT_END,
      seq: 5,
    };
    const next = applyParentToolCall(runs, event);
    expect(next[0]).toMatchObject({ status: "running" });
    expect(next[0]).not.toHaveProperty("endedAt");
  });
});

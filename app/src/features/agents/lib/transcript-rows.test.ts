import { describe, expect, it } from "vitest";
import type { NestedStep, TranscriptEvent } from "@server/schemas";
import {
  deriveTurns,
  groupOrdinaryNestedToolCalls,
  groupOrdinaryToolCalls,
  transcriptInfoLine,
  toolUseGroupHintEvent,
  toolUseGroupStatus,
  type OrdinaryToolCallEvent,
} from "./transcript-rows";
import type { CollapsedDelegation } from "./subagent";

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

  it("renders a delegation_recovery event as a Recovery info line", () => {
    expect(
      transcriptInfoLine({
        type: "delegation_recovery",
        at,
        failureClass: "auth",
        madeProgress: false,
        cancelledDelegations: 1,
        message:
          "A nested delegation failed with auth. Cancelled 1 nested delegation(s). The turn had made no progress.",
      }),
    ).toEqual({
      label: "Recovery",
      text: "A nested delegation failed with auth. Cancelled 1 nested delegation(s). The turn had made no progress.",
    });
  });
});

function tool(
  callId: string,
  status: "running" | "completed" | "error" = "completed",
  name = "Read",
): OrdinaryToolCallEvent {
  return { type: "tool_call", at, callId, name, status };
}

function usage(seq = 1): TranscriptEvent {
  return {
    type: "usage",
    at,
    usage: {
      totalTokens: seq,
      inputTokens: seq,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}

describe("groupOrdinaryToolCalls", () => {
  it("coalesces consecutive ordinary tools into one group", () => {
    const a = tool("c1");
    const b = tool("c2");
    const c = tool("c3");
    expect(groupOrdinaryToolCalls([a, b, c])).toEqual([
      { kind: "tool_use_group", events: [a, b, c] },
    ]);
  });

  it("wraps a lone ordinary tool in a one-item group", () => {
    const only = tool("c1");
    expect(groupOrdinaryToolCalls([only])).toEqual([
      { kind: "tool_use_group", events: [only] },
    ]);
  });

  it("breaks groups on thinking, assistant, and subagent/delegation rows", () => {
    const t1 = tool("c1");
    const thinking: TranscriptEvent = { type: "thinking", at, text: "hmm" };
    const t2 = tool("c2");
    const assistant: TranscriptEvent = { type: "assistant", at, text: "done" };
    const t3 = tool("c3");
    const task: TranscriptEvent = {
      type: "tool_call",
      at,
      callId: "task-1",
      name: "Task",
      status: "completed",
      args: { prompt: "investigate" },
    };
    const t4 = tool("c4");
    const mcp: TranscriptEvent = {
      type: "tool_call",
      at,
      callId: "mcp-1",
      name: "CallMcpTool",
      status: "completed",
      args: {
        providerIdentifier: "custom-user-tools",
        toolName: "delegate",
        args: { role: "implementor", prompt: "do it" },
      },
    };
    const t5 = tool("c5");

    expect(
      groupOrdinaryToolCalls([
        t1,
        thinking,
        t2,
        assistant,
        t3,
        task,
        t4,
        mcp,
        t5,
      ]),
    ).toEqual([
      { kind: "tool_use_group", events: [t1] },
      { kind: "row", event: thinking },
      { kind: "tool_use_group", events: [t2] },
      { kind: "row", event: assistant },
      { kind: "tool_use_group", events: [t3] },
      { kind: "row", event: task },
      { kind: "tool_use_group", events: [t4] },
      { kind: "row", event: mcp },
      { kind: "tool_use_group", events: [t5] },
    ]);
  });

  it("looks past omitted usage / bare status / subagent_update noise", () => {
    const a = tool("c1");
    const b = tool("c2");
    const noise: TranscriptEvent[] = [
      usage(),
      { type: "status", at, status: "RUNNING" },
      {
        type: "subagent_update",
        at,
        parentCallId: "other",
        step: { kind: "liveness", elapsedMs: 1 },
      },
    ];
    expect(groupOrdinaryToolCalls([a, ...noise, b])).toEqual([
      { kind: "tool_use_group", events: [a, b] },
    ]);
  });

  it("passes through prompts and other visible non-tool rows", () => {
    const prompt: TranscriptEvent = { type: "prompt", at, text: "go" };
    const a = tool("c1");
    const info: TranscriptEvent = {
      type: "status",
      at,
      status: "FINISHED",
      message: "paused",
    };
    expect(groupOrdinaryToolCalls([prompt, a, info])).toEqual([
      { kind: "row", event: prompt },
      { kind: "tool_use_group", events: [a] },
      { kind: "row", event: info },
    ]);
  });
});

describe("toolUseGroupStatus", () => {
  it("is running when any child is running and none errored", () => {
    expect(
      toolUseGroupStatus([tool("c1", "completed"), tool("c2", "running")]),
    ).toBe("running");
  });

  it("is error when any child errored", () => {
    expect(
      toolUseGroupStatus([
        tool("c1", "completed"),
        tool("c2", "error"),
        tool("c3", "running"),
      ]),
    ).toBe("error");
  });

  it("is completed when every child completed", () => {
    expect(
      toolUseGroupStatus([tool("c1", "completed"), tool("c2", "completed")]),
    ).toBe("completed");
  });
});

describe("toolUseGroupHintEvent", () => {
  it("returns the latest running tool in transcript order", () => {
    const t1 = tool("c1", "completed", "Read");
    const t2 = tool("c2", "running", "Grep");
    const t3 = tool("c3", "running", "Shell");
    expect(toolUseGroupHintEvent([t1, t2, t3])).toBe(t3);
  });

  it("returns the last tool when none are running", () => {
    const t1 = tool("c1", "completed", "Read");
    const t2 = tool("c2", "completed", "Grep");
    expect(toolUseGroupHintEvent([t1, t2])).toBe(t2);
  });

  it("returns the last tool when the group errored", () => {
    const t1 = tool("c1", "completed", "Read");
    const t2 = tool("c2", "error", "Shell");
    expect(toolUseGroupHintEvent([t1, t2])).toBe(t2);
  });

  it("returns undefined for an empty group", () => {
    expect(toolUseGroupHintEvent([])).toBeUndefined();
  });
});

function nestedTool(
  callId: string,
  status: "running" | "completed" | "error" = "completed",
  name = "Read",
): Extract<NestedStep, { kind: "tool_call" }> {
  return { kind: "tool_call", callId, name, status };
}

const noCollapsed = new Map<string, CollapsedDelegation>();

describe("groupOrdinaryNestedToolCalls", () => {
  it("coalesces consecutive ordinary nested tools into one group", () => {
    const a = nestedTool("c1");
    const b = nestedTool("c2");
    const c = nestedTool("c3");
    expect(groupOrdinaryNestedToolCalls([a, b, c], noCollapsed)).toEqual([
      { kind: "tool_use_group", steps: [a, b, c] },
    ]);
  });

  it("wraps a lone ordinary nested tool in a one-item group", () => {
    const only = nestedTool("c1");
    expect(groupOrdinaryNestedToolCalls([only], noCollapsed)).toEqual([
      { kind: "tool_use_group", steps: [only] },
    ]);
  });

  it("breaks groups on thinking, text, step markers, and collapsed-delegation tool calls", () => {
    const t1 = nestedTool("c1");
    const thinking = { kind: "thinking" as const, text: "hmm" };
    const t2 = nestedTool("c2");
    const text = { kind: "text" as const, text: "done" };
    const t3 = nestedTool("c3");
    const marker = {
      kind: "step" as const,
      stepId: 1,
      status: "started" as const,
    };
    const t4 = nestedTool("c4");
    const collapsedTool = nestedTool("delegate-1", "completed", "Task");
    const t5 = nestedTool("c5");
    const collapsedByCallId = new Map<string, CollapsedDelegation>([
      [
        "delegate-1",
        {
          delegationId: "d1",
          parentCallId: "delegate-1",
          status: "completed",
        },
      ],
    ]);

    expect(
      groupOrdinaryNestedToolCalls(
        [t1, thinking, t2, text, t3, marker, t4, collapsedTool, t5],
        collapsedByCallId,
      ),
    ).toEqual([
      { kind: "tool_use_group", steps: [t1] },
      { kind: "row", step: thinking },
      { kind: "tool_use_group", steps: [t2] },
      { kind: "row", step: text },
      { kind: "tool_use_group", steps: [t3] },
      { kind: "row", step: marker },
      { kind: "tool_use_group", steps: [t4] },
      { kind: "row", step: collapsedTool },
      { kind: "tool_use_group", steps: [t5] },
    ]);
  });

  it("looks past liveness without splitting a group", () => {
    const a = nestedTool("c1");
    const b = nestedTool("c2");
    expect(
      groupOrdinaryNestedToolCalls(
        [a, { kind: "liveness", elapsedMs: 1200 }, b],
        noCollapsed,
      ),
    ).toEqual([{ kind: "tool_use_group", steps: [a, b] }]);
  });
});

function usageAt(seq: number): TranscriptEvent {
  return {
    type: "usage",
    at,
    seq,
    usage: {
      totalTokens: 1,
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  };
}

describe("deriveTurns", () => {
  it("yields one entry per prompt in a multi-turn transcript", () => {
    expect(
      deriveTurns([
        { type: "prompt", at, seq: 1, text: "first" },
        { type: "assistant", at, seq: 2, text: "one" },
        usageAt(3),
        { type: "prompt", at, seq: 4, text: "second" },
        { type: "assistant", at, seq: 5, text: "two" },
        usageAt(6),
      ]),
    ).toEqual([
      { lastAssistantSeq: 2, lastEventSeq: 3, isLastTurn: false },
      { lastAssistantSeq: 5, lastEventSeq: 6, isLastTurn: true },
    ]);
  });

  it("puts lastEventSeq after lastAssistantSeq when usage trails the assistant", () => {
    expect(
      deriveTurns([
        { type: "prompt", at, seq: 1, text: "go" },
        { type: "assistant", at, seq: 2, text: "done" },
        usageAt(3),
        { type: "request", at, seq: 4, requestId: "req-1" },
        {
          type: "delegation_recovery",
          at,
          seq: 5,
          failureClass: "auth",
          madeProgress: false,
          cancelledDelegations: 0,
          message: "recovered",
        },
      ]),
    ).toEqual([
      { lastAssistantSeq: 2, lastEventSeq: 5, isLastTurn: true },
    ]);
  });

  it("reports the final assistant after thinking and tool calls in the turn", () => {
    expect(
      deriveTurns([
        { type: "prompt", at, seq: 1, text: "read it" },
        { type: "thinking", at, seq: 2, text: "hmm" },
        {
          type: "tool_call",
          at,
          seq: 3,
          callId: "c1",
          name: "Read",
          status: "completed",
        },
        { type: "assistant", at, seq: 4, text: "draft" },
        { type: "thinking", at, seq: 5, text: "more" },
        {
          type: "tool_call",
          at,
          seq: 6,
          callId: "c2",
          name: "Grep",
          status: "completed",
        },
        { type: "assistant", at, seq: 7, text: "final" },
      ]),
    ).toEqual([
      { lastAssistantSeq: 7, lastEventSeq: 7, isLastTurn: true },
    ]);
  });

  it("leaves lastAssistantSeq off a trailing turn that has no assistant yet", () => {
    expect(
      deriveTurns([
        { type: "prompt", at, seq: 1, text: "first" },
        { type: "assistant", at, seq: 2, text: "one" },
        usageAt(3),
        { type: "prompt", at, seq: 4, text: "second" },
      ]),
    ).toEqual([
      { lastAssistantSeq: 2, lastEventSeq: 3, isLastTurn: false },
      { lastEventSeq: 4, isLastTurn: true },
    ]);
  });

  it("groups by stored seq first even when the array is out of order", () => {
    expect(
      deriveTurns([
        usageAt(3),
        { type: "assistant", at, seq: 2, text: "one" },
        { type: "prompt", at, seq: 4, text: "second" },
        { type: "prompt", at, seq: 1, text: "first" },
        { type: "assistant", at, seq: 5, text: "two" },
      ]),
    ).toEqual([
      { lastAssistantSeq: 2, lastEventSeq: 3, isLastTurn: false },
      { lastAssistantSeq: 5, lastEventSeq: 5, isLastTurn: true },
    ]);
  });
});


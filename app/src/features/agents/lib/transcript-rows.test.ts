import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import {
  groupOrdinaryToolCalls,
  transcriptInfoLine,
  toolUseGroupHintEvent,
  toolUseGroupStatus,
  type OrdinaryToolCallEvent,
} from "./transcript-rows";

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


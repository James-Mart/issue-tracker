import { describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import {
  deriveSubAgent,
  deriveSubAgents,
  isSubAgentToolCall,
} from "./subagent";

const TASK_CALL_ID = "call-task-1";
const MCP_CALL_ID = "tool_mcp-delegate-1";
const NESTED_AGENT_ID = "bc-nested-1";
const AT = "2026-07-24T00:00:00.000Z";

type Unstamped<E> = E extends unknown ? Omit<E, "at"> : never;

function at(event: Unstamped<TranscriptEvent>, stamp = AT): TranscriptEvent {
  return { ...event, at: stamp };
}

/** Persisted shape of the fixture nested sequence + completed Task tool_call. */
function fixtureWithNested(): TranscriptEvent[] {
  return [
    at({
      type: "subagent_update",
      parentCallId: TASK_CALL_ID,
      step: { kind: "text", text: "Reading the file." },
    }),
    at({
      type: "subagent_update",
      parentCallId: TASK_CALL_ID,
      step: { kind: "thinking", text: "Considering options." },
    }),
    at({
      type: "subagent_update",
      parentCallId: TASK_CALL_ID,
      step: {
        kind: "tool_call",
        callId: "nested-shell-1",
        name: "shell",
        status: "completed",
        args: { command: "ls -a" },
        result: {
          status: "success",
          value: {
            exitCode: 0,
            signal: "",
            stdout: "README.md\n",
            stderr: "",
            executionTime: 4,
          },
        },
      },
    }),
    at({
      type: "subagent_update",
      parentCallId: TASK_CALL_ID,
      step: { kind: "step", stepId: 1, status: "started" },
    }),
    at({
      type: "subagent_update",
      parentCallId: TASK_CALL_ID,
      step: { kind: "step", stepId: 1, status: "completed" },
    }),
    at({
      type: "tool_call",
      callId: TASK_CALL_ID,
      name: "Task",
      status: "completed",
      args: { description: "Investigate", prompt: "look into it" },
      result: { result: "delegation done", agentId: NESTED_AGENT_ID },
      resultAgentId: NESTED_AGENT_ID,
    }),
  ];
}

describe("deriveSubAgents", () => {
  it("derives ordered steps, status, and resumeAgentId from the nested fixture", () => {
    const agents = deriveSubAgents(fixtureWithNested());
    expect(agents).toHaveLength(1);
    const agent = agents[0]!;
    expect(agent.callId).toBe(TASK_CALL_ID);
    expect(agent.description).toBe("Investigate");
    expect(agent.prompt).toBe("look into it");
    expect(agent.status).toBe("completed");
    expect(agent.resumeAgentId).toBe(NESTED_AGENT_ID);
    expect(agent.result).toEqual({
      result: "delegation done",
      agentId: NESTED_AGENT_ID,
    });
    expect(agent.steps.map((s) => s.kind)).toEqual([
      "text",
      "thinking",
      "tool_call",
      "step",
      "step",
    ]);
    expect(agent.steps[0]).toEqual({
      kind: "text",
      text: "Reading the file.",
    });
    expect(agent.steps[1]).toEqual({
      kind: "thinking",
      text: "Considering options.",
    });
    expect(agent.steps[2]).toMatchObject({
      kind: "tool_call",
      callId: "nested-shell-1",
      name: "shell",
      status: "completed",
    });
  });

  it("never throws on missing or oddly-shaped payloads", () => {
    const weird: TranscriptEvent[] = [
      at({
        type: "tool_call",
        callId: "c-odd",
        name: "Task",
        status: "running",
        args: null as unknown as Record<string, unknown>,
      }),
      at({
        type: "tool_call",
        callId: "c-odd",
        name: "Task",
        status: "completed",
        args: {
          description: 42,
          prompt: { nested: true },
          subagentType: "explore",
          name: ["not", "a", "string"],
        } as unknown as Record<string, unknown>,
        result: "plain-string-result",
      }),
      at({
        type: "subagent_update",
        parentCallId: "c-odd",
        step: { kind: "text", text: "ok" },
      }),
      at({
        type: "tool_call",
        callId: "c-read",
        name: "read",
        status: "completed",
      }),
      at({
        type: "tool_call",
        callId: "c-agent",
        name: "Agent",
        status: "error",
        args: undefined,
      }),
    ];

    expect(() => deriveSubAgents(weird)).not.toThrow();
    const agents = deriveSubAgents(weird);
    expect(agents.map((a) => a.callId)).toEqual(["c-odd", "c-agent"]);
    expect(agents[0]).toMatchObject({
      callId: "c-odd",
      status: "completed",
      steps: [{ kind: "text", text: "ok" }],
    });
    expect(agents[0]!.name).toBeUndefined();
    expect(agents[0]!.description).toBeUndefined();
    expect(agents[0]!.prompt).toBeUndefined();
    expect(agents[0]!.resumeAgentId).toBeUndefined();
    expect(agents[1]).toMatchObject({
      callId: "c-agent",
      status: "error",
      steps: [],
    });
  });

  it("recognizes app-channel MCP delegate tool calls and attaches nested steps", () => {
    const events: TranscriptEvent[] = [
      at({
        type: "subagent_update",
        parentCallId: MCP_CALL_ID,
        delegationId: "del-mcp-1",
        model: '{"id":"composer-2.5"}',
        step: { kind: "text", text: "Reading the git subagent docs." },
      }),
      at({
        type: "subagent_update",
        parentCallId: MCP_CALL_ID,
        delegationId: "del-mcp-1",
        model: '{"id":"composer-2.5"}',
        step: {
          kind: "tool_call",
          callId: "nested-read-1",
          name: "read",
          status: "completed",
          args: { path: "/agents/_issue-tracker-cli.md" },
        },
      }),
      at({
        type: "subagent_update",
        parentCallId: MCP_CALL_ID,
        delegationId: "del-mcp-1",
        model: '{"id":"composer-2.5"}',
        step: { kind: "liveness", elapsedMs: 8500 },
      }),
      at({
        type: "tool_call",
        callId: MCP_CALL_ID,
        name: "mcp",
        status: "completed",
        args: {
          providerIdentifier: "custom-user-tools",
          toolName: "delegate",
          args: {
            role: "issue-tracker-git",
            prompt: "Mode: start-branch. Issue: compact-transcript-rows.",
          },
        },
        result: { status: "success", value: { reply: "Branch created." } },
      }),
    ];

    const toolCall = events.find(
      (e): e is Extract<TranscriptEvent, { type: "tool_call" }> =>
        e.type === "tool_call" && e.callId === MCP_CALL_ID,
    )!;
    expect(isSubAgentToolCall(toolCall)).toBe(true);

    const agent = deriveSubAgent(events, MCP_CALL_ID)!;
    expect(agent.role).toBe("issue-tracker-git");
    expect(agent.prompt).toBe(
      "Mode: start-branch. Issue: compact-transcript-rows.",
    );
    expect(agent.model).toBe("composer-2.5");
    expect(agent.elapsedMs).toBe(8500);
    expect(agent.status).toBe("completed");
    expect(agent.steps.map((s) => s.kind)).toEqual([
      "text",
      "tool_call",
      "liveness",
    ]);
    expect(agent.steps[0]).toEqual({
      kind: "text",
      text: "Reading the git subagent docs.",
    });
  });
});

import { describe, expect, it } from "vitest";
import type { NestedStep, TranscriptEvent } from "@server/schemas";
import {
  applyNestedStep,
  deriveSubAgent,
  deriveSubAgents,
  isSubAgentToolCall,
  isSubAgentToolName,
} from "./subagent";

const TASK_CALL_ID = "call-task-1";
const MCP_CALL_ID = "tool_mcp-delegate-1";
const NESTED_AGENT_ID = "bc-nested-1";
const AT = "2026-07-24T00:00:00.000Z";

function at(
  event: Omit<TranscriptEvent, "at">,
  stamp = AT,
): TranscriptEvent {
  return { ...event, at: stamp } as TranscriptEvent;
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

/** No-delta fallback: parent Task only, no subagent_update events. */
function fixtureWithoutNested(): TranscriptEvent[] {
  return [
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

describe("isSubAgentToolName", () => {
  it("recognizes Agent and Task case-insensitively", () => {
    expect(isSubAgentToolName("Task")).toBe(true);
    expect(isSubAgentToolName("Agent")).toBe(true);
    expect(isSubAgentToolName("task")).toBe(true);
    expect(isSubAgentToolName("agent")).toBe(true);
    expect(isSubAgentToolName("read")).toBe(false);
    expect(isSubAgentToolName(undefined)).toBe(false);
    expect(isSubAgentToolName(null)).toBe(false);
  });
});

describe("applyNestedStep", () => {
  it("concatenates consecutive text deltas and skips the finalize duplicate", () => {
    let steps = applyNestedStep([], { kind: "text", text: "Hel" });
    steps = applyNestedStep(steps, { kind: "text", text: "lo" });
    expect(steps).toEqual([{ kind: "text", text: "Hello" }]);
    steps = applyNestedStep(steps, { kind: "text", text: "Hello" });
    expect(steps).toEqual([{ kind: "text", text: "Hello" }]);
  });

  it("concatenates consecutive thinking deltas the same way", () => {
    let steps = applyNestedStep([], {
      kind: "thinking",
      text: "Consider",
    });
    steps = applyNestedStep(steps, { kind: "thinking", text: "ing." });
    steps = applyNestedStep(steps, {
      kind: "thinking",
      text: "Considering.",
    });
    expect(steps).toEqual([{ kind: "thinking", text: "Considering." }]);
  });

  it("coalesces thinking across liveness and skips the finalize duplicate", () => {
    let steps = applyNestedStep([], { kind: "thinking", text: "Aa" });
    steps = applyNestedStep(steps, { kind: "liveness", elapsedMs: 12 });
    steps = applyNestedStep(steps, { kind: "thinking", text: "Bb" });
    steps = applyNestedStep(steps, { kind: "thinking", text: "AaBb" });
    expect(steps).toEqual([
      { kind: "thinking", text: "AaBb" },
      { kind: "liveness", elapsedMs: 12 },
    ]);
  });

  it("starts a new thinking block after text, tool_call, or step markers", () => {
    const interrupts: NestedStep[] = [
      { kind: "text", text: "out" },
      {
        kind: "tool_call",
        callId: "n1",
        name: "shell",
        status: "running",
      },
      { kind: "step", stepId: 1, status: "started" },
    ];

    for (const interrupt of interrupts) {
      let steps = applyNestedStep([], { kind: "thinking", text: "first" });
      steps = applyNestedStep(steps, interrupt);
      steps = applyNestedStep(steps, { kind: "thinking", text: "second" });
      expect(steps).toEqual([
        { kind: "thinking", text: "first" },
        interrupt,
        { kind: "thinking", text: "second" },
      ]);
    }
  });

  it("omits empty and whitespace-only nested thinking", () => {
    let steps = applyNestedStep([], { kind: "thinking", text: "   " });
    expect(steps).toEqual([]);

    steps = applyNestedStep(steps, { kind: "thinking", text: "kept" });
    steps = applyNestedStep(steps, { kind: "liveness", elapsedMs: 3 });
    steps = applyNestedStep(steps, { kind: "thinking", text: "" });
    steps = applyNestedStep(steps, { kind: "thinking", text: "\n\t" });
    expect(steps).toEqual([
      { kind: "thinking", text: "kept" },
      { kind: "liveness", elapsedMs: 3 },
    ]);
  });

  it("replaces nested tool_call frames with the same callId", () => {
    let steps = applyNestedStep([], {
      kind: "tool_call",
      callId: "n1",
      name: "shell",
      status: "running",
    });
    steps = applyNestedStep(steps, {
      kind: "tool_call",
      callId: "n1",
      name: "shell",
      status: "completed",
      result: { ok: true },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: "tool_call",
      callId: "n1",
      status: "completed",
      result: { ok: true },
    });
  });
});

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

  it("yields empty steps for the no-delta fallback fixture", () => {
    const agent = deriveSubAgent(fixtureWithoutNested(), TASK_CALL_ID);
    expect(agent).toBeDefined();
    expect(agent!.steps).toEqual([]);
    expect(agent!.status).toBe("completed");
    expect(agent!.resumeAgentId).toBe(NESTED_AGENT_ID);
  });

  it("coalesces live incremental nested frames to the same steps as replay", () => {
    const live: TranscriptEvent[] = [
      at({
        type: "tool_call",
        callId: TASK_CALL_ID,
        name: "Task",
        status: "running",
        args: { description: "Investigate", prompt: "look into it" },
      }),
      // Live text delta + finalize (full coalesced text).
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "text", text: "Reading the file." },
      }),
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "text", text: "Reading the file." },
      }),
      // Live thinking delta + finalize.
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "thinking", text: "Considering options." },
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
          status: "running",
        },
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
        type: "tool_call",
        callId: TASK_CALL_ID,
        name: "Task",
        status: "completed",
        args: { description: "Investigate", prompt: "look into it" },
        result: { result: "delegation done", agentId: NESTED_AGENT_ID },
        resultAgentId: NESTED_AGENT_ID,
      }),
    ];

    const liveAgent = deriveSubAgent(live, TASK_CALL_ID)!;
    const replayAgent = deriveSubAgent(fixtureWithNested(), TASK_CALL_ID)!;

    expect(liveAgent.steps).toEqual(
      replayAgent.steps.filter((s) => s.kind !== "step"),
    );
    expect(liveAgent.resumeAgentId).toBe(NESTED_AGENT_ID);
    expect(liveAgent.status).toBe("completed");
  });

  it("replays persisted nested thinking with the same liveness coalesce and empty omit as live apply", () => {
    let liveSteps: NestedStep[] = [];
    liveSteps = applyNestedStep(liveSteps, { kind: "thinking", text: "Aa" });
    liveSteps = applyNestedStep(liveSteps, {
      kind: "liveness",
      elapsedMs: 40,
    });
    liveSteps = applyNestedStep(liveSteps, { kind: "thinking", text: "Bb" });
    liveSteps = applyNestedStep(liveSteps, { kind: "thinking", text: "AaBb" });
    liveSteps = applyNestedStep(liveSteps, { kind: "thinking", text: "   " });
    liveSteps = applyNestedStep(liveSteps, {
      kind: "tool_call",
      callId: "n-split",
      name: "shell",
      status: "completed",
    });
    liveSteps = applyNestedStep(liveSteps, {
      kind: "thinking",
      text: "after",
    });

    const persisted: TranscriptEvent[] = [
      at({
        type: "tool_call",
        callId: TASK_CALL_ID,
        name: "Task",
        status: "running",
        args: { description: "Investigate", prompt: "look into it" },
      }),
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "thinking", text: "Aa" },
      }),
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "liveness", elapsedMs: 40 },
      }),
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "thinking", text: "Bb" },
      }),
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "thinking", text: "AaBb" },
      }),
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "thinking", text: "   " },
      }),
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: {
          kind: "tool_call",
          callId: "n-split",
          name: "shell",
          status: "completed",
        },
      }),
      at({
        type: "subagent_update",
        parentCallId: TASK_CALL_ID,
        step: { kind: "thinking", text: "after" },
      }),
    ];

    expect(deriveSubAgent(persisted, TASK_CALL_ID)!.steps).toEqual(liveSteps);
    expect(liveSteps).toEqual([
      { kind: "thinking", text: "AaBb" },
      { kind: "liveness", elapsedMs: 40 },
      {
        kind: "tool_call",
        callId: "n-split",
        name: "shell",
        status: "completed",
      },
      { kind: "thinking", text: "after" },
    ]);
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

  it("reads subagentType.name when present", () => {
    const events = [
      at({
        type: "tool_call",
        callId: "c1",
        name: "Task",
        status: "completed",
        args: {
          description: "Explore",
          prompt: "go",
          subagentType: { kind: "custom", name: "explore" },
        },
      }),
    ];
    expect(deriveSubAgent(events, "c1")?.name).toBe("explore");
  });

  it("collapses a depth-2 run into one summary row with role, model, status, elapsed", () => {
    const rootCallId = "call-root";
    const innerCallId = "call-inner";
    const rootDelegationId = "del-root";
    const innerDelegationId = "del-inner";
    const model = "composer-2.5";

    const events: TranscriptEvent[] = [
      at({
        type: "tool_call",
        callId: rootCallId,
        name: "Task",
        status: "running",
        args: { description: "Coordinate", prompt: "fan out" },
      }),
      at({
        type: "subagent_update",
        parentCallId: rootCallId,
        delegationId: rootDelegationId,
        model,
        step: { kind: "text", text: "Starting children." },
      }),
      at({
        type: "subagent_update",
        parentCallId: rootCallId,
        delegationId: rootDelegationId,
        model,
        step: {
          kind: "tool_call",
          callId: innerCallId,
          name: "delegate",
          status: "running",
          args: { role: "explore", prompt: "look deeper" },
        },
      }),
      // Depth-2 frames — different parentCallId, parentDelegationId set.
      at({
        type: "subagent_update",
        parentCallId: innerCallId,
        delegationId: innerDelegationId,
        parentDelegationId: rootDelegationId,
        model: "cursor-grok-4.5-high-fast",
        step: { kind: "liveness", elapsedMs: 5000 },
      }),
      at({
        type: "subagent_update",
        parentCallId: innerCallId,
        delegationId: innerDelegationId,
        parentDelegationId: rootDelegationId,
        model: "cursor-grok-4.5-high-fast",
        step: { kind: "text", text: "Deep work (must not expand)." },
      }),
      at({
        type: "subagent_update",
        parentCallId: innerCallId,
        delegationId: innerDelegationId,
        parentDelegationId: rootDelegationId,
        model: "cursor-grok-4.5-high-fast",
        step: { kind: "liveness", elapsedMs: 10000 },
      }),
    ];

    const agent = deriveSubAgent(events, rootCallId)!;
    expect(agent.steps.map((s) => s.kind)).toEqual(["text", "tool_call"]);
    expect(agent.steps.some((s) => s.kind === "text" && s.text.includes("Deep"))).toBe(
      false,
    );
    expect(agent.collapsedDelegations).toHaveLength(1);
    expect(agent.collapsedDelegations[0]).toEqual({
      delegationId: innerDelegationId,
      parentCallId: innerCallId,
      role: "explore",
      model: "cursor-grok-4.5-high-fast",
      status: "running",
      elapsedMs: 10000,
    });
  });

  it("updates elapsed on a depth-2 run that emits only liveness steps", () => {
    const rootCallId = "call-root";
    const innerCallId = "call-silent";
    const rootDelegationId = "del-root";
    const innerDelegationId = "del-silent";

    const base: TranscriptEvent[] = [
      at({
        type: "tool_call",
        callId: rootCallId,
        name: "Task",
        status: "running",
        args: { description: "Wait", prompt: "hold" },
      }),
      at({
        type: "subagent_update",
        parentCallId: rootCallId,
        delegationId: rootDelegationId,
        model: "composer-2.5",
        step: {
          kind: "tool_call",
          callId: innerCallId,
          name: "delegate",
          status: "running",
          args: { role: "pinned-role", prompt: "stay quiet" },
        },
      }),
    ];

    const afterFirst = [
      ...base,
      at({
        type: "subagent_update",
        parentCallId: innerCallId,
        delegationId: innerDelegationId,
        parentDelegationId: rootDelegationId,
        model: "cursor-grok-4.5-high-fast",
        step: { kind: "liveness", elapsedMs: 5000 },
      }),
    ];
    const afterSecond = [
      ...afterFirst,
      at({
        type: "subagent_update",
        parentCallId: innerCallId,
        delegationId: innerDelegationId,
        parentDelegationId: rootDelegationId,
        model: "cursor-grok-4.5-high-fast",
        step: { kind: "liveness", elapsedMs: 10000 },
      }),
    ];

    const first = deriveSubAgent(afterFirst, rootCallId)!;
    expect(first.collapsedDelegations).toHaveLength(1);
    expect(first.collapsedDelegations[0]).toMatchObject({
      role: "pinned-role",
      model: "cursor-grok-4.5-high-fast",
      status: "running",
      elapsedMs: 5000,
    });

    const second = deriveSubAgent(afterSecond, rootCallId)!;
    expect(second.collapsedDelegations).toHaveLength(1);
    expect(second.collapsedDelegations[0]?.elapsedMs).toBe(10000);
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

  it("derives a lowercase task tool call the same as Task", () => {
    const events = [
      at({
        type: "tool_call",
        callId: "call-lower",
        name: "task",
        status: "completed",
        args: { description: "Do work", prompt: "go" },
      }),
    ];
    expect(deriveSubAgents(events)).toHaveLength(1);
    expect(deriveSubAgent(events, "call-lower")).toMatchObject({
      description: "Do work",
      prompt: "go",
      status: "completed",
    });
  });
});

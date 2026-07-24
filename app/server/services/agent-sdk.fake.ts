import type {
  NestedTaskUpdate,
  SDKMessage,
  SDKModel,
} from "@cursor/sdk";
import type {
  AgentHandle,
  AgentSdk,
  AgentSendOptions,
  AgentStreamEvent,
  CreateAgentOptions,
} from "./agent-sdk.js";

// Stable identifiers the scripted fixtures share, so tests can assert that
// nested updates are tagged with the parent Task tool call.
export const FAKE_AGENT_ID = "agent-fake-1";
export const FAKE_RUN_ID = "run-fake-1";
export const PRIMARY_TOOL_CALL_ID = "call-read-1";
export const TASK_TOOL_CALL_ID = "call-task-1";
export const NESTED_MODEL_CALL_ID = "model-call-1";
export const NESTED_AGENT_ID = "bc-nested-1";

export const FAKE_MODELS: SDKModel[] = [
  { id: "composer-2.5", displayName: "Composer 2.5" },
  { id: "auto", displayName: "Auto" },
];

export interface FixtureOptions {
  /** Include the nested `tool-call-delta` sequence. Default `true`. */
  includeNested?: boolean;
  /**
   * When set, the completed Task tool call carries this id as its `result`'s
   * optional `agentId` hint (used to resume the spawned sub-agent later).
   */
  taskResultAgentId?: string;
}

function message(m: SDKMessage): AgentStreamEvent {
  return { kind: "message", message: m };
}

function nested(update: NestedTaskUpdate): AgentStreamEvent {
  return {
    kind: "nested",
    callId: TASK_TOOL_CALL_ID,
    modelCallId: NESTED_MODEL_CALL_ID,
    update,
  };
}

const ids = { agent_id: FAKE_AGENT_ID, run_id: FAKE_RUN_ID } as const;

/**
 * A scripted merged stream covering the full boundary surface: every top-level
 * `SDKMessage` variant the app cares about PLUS the nested `tool-call-delta`
 * sequence keyed to the parent Task tool call. Other Stories' tests reuse this
 * so nested-thread behavior is exercised by the default (mocked) suite.
 */
export function buildScriptedStream(
  options: FixtureOptions = {},
): AgentStreamEvent[] {
  const { includeNested = true, taskResultAgentId } = options;

  const nestedSequence: AgentStreamEvent[] = includeNested
    ? [
        nested({ type: "text-delta", text: "Reading the file." }),
        nested({ type: "thinking-delta", text: "Considering options." }),
        nested({ type: "thinking-completed", thinkingDurationMs: 8 }),
        nested({
          type: "tool-call-started",
          callId: "nested-shell-1",
          toolCall: { type: "shell", args: { command: "ls -a" } },
        } as NestedTaskUpdate),
        nested({
          type: "tool-call-completed",
          callId: "nested-shell-1",
          toolCall: {
            type: "shell",
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
        } as NestedTaskUpdate),
        nested({ type: "step-started", stepId: 1 }),
        nested({ type: "step-completed", stepId: 1, stepDurationMs: 30 }),
      ]
    : [];

  const taskResult: Record<string, unknown> = { result: "delegation done" };
  if (taskResultAgentId) taskResult.agentId = taskResultAgentId;

  return [
    message({
      type: "assistant",
      ...ids,
      message: { role: "assistant", content: [{ type: "text", text: "On it." }] },
    }),
    message({ type: "thinking", ...ids, text: "Planning.", thinking_duration_ms: 5 }),
    message({
      type: "tool_call",
      ...ids,
      call_id: PRIMARY_TOOL_CALL_ID,
      name: "read",
      status: "running",
      args: { path: "README.md" },
    }),
    message({
      type: "tool_call",
      ...ids,
      call_id: PRIMARY_TOOL_CALL_ID,
      name: "read",
      status: "completed",
      result: { content: "# Readme" },
    }),
    message({ type: "task", ...ids, status: "in_progress", text: "Delegating." }),
    message({ type: "status", ...ids, status: "RUNNING" }),
    message({
      type: "usage",
      ...ids,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
      },
    }),
    message({ type: "request", ...ids, request_id: "req-1" }),
    message({
      type: "tool_call",
      ...ids,
      call_id: TASK_TOOL_CALL_ID,
      name: "Task",
      status: "running",
      args: { description: "Investigate", prompt: "look into it" },
    }),
    ...nestedSequence,
    message({
      type: "tool_call",
      ...ids,
      call_id: TASK_TOOL_CALL_ID,
      name: "Task",
      status: "completed",
      result: taskResult,
    }),
  ];
}

/** Fallback path: a scripted stream with no nested `tool-call-delta` at all. */
export function buildScriptedStreamWithoutNested(): AgentStreamEvent[] {
  return buildScriptedStream({ includeNested: false });
}

/** Variant whose completed Task tool call carries the optional `agentId` hint. */
export function buildScriptedStreamWithAgentIdHint(): AgentStreamEvent[] {
  return buildScriptedStream({ taskResultAgentId: NESTED_AGENT_ID });
}

export interface FakeSend {
  prompt: string;
  options: AgentSendOptions;
}

export interface FakeAgentHandle extends AgentHandle {
  /** Every `send(...)` recorded in order. */
  readonly sends: FakeSend[];
  /** Whether `cancel()` was called. */
  cancelled: boolean;
  /** Whether the handle was disposed. */
  disposed: boolean;
}

export interface FakeAgentSdkOptions {
  models?: SDKModel[];
  /** Events every `send(...)` yields. Defaults to {@link buildScriptedStream}. */
  stream?: AgentStreamEvent[];
}

export interface FakeAgentSdk extends AgentSdk {
  /** Options passed to each `createAgent(...)`. */
  readonly created: CreateAgentOptions[];
  /** Agent ids passed to each `resumeAgent(...)`. */
  readonly resumed: string[];
  /** Every handle this fake handed out. */
  readonly handles: FakeAgentHandle[];
}

/**
 * A fake {@link AgentSdk} for the default (mocked) test suite: it never touches
 * `@cursor/sdk` or the network. Each handle's `send` replays the scripted merged
 * stream so consumers exercise real nested-thread handling without spending
 * tokens.
 */
export function createFakeAgentSdk(
  options: FakeAgentSdkOptions = {},
): FakeAgentSdk {
  const models = options.models ?? FAKE_MODELS;
  const stream = options.stream ?? buildScriptedStream();
  const created: CreateAgentOptions[] = [];
  const resumed: string[] = [];
  const handles: FakeAgentHandle[] = [];

  function makeHandle(agentId: string): FakeAgentHandle {
    const handle: FakeAgentHandle = {
      agentId,
      sends: [],
      cancelled: false,
      disposed: false,
      send(prompt, sendOptions = {}) {
        handle.sends.push({ prompt, options: sendOptions });
        return (async function* () {
          for (const event of stream) yield event;
        })();
      },
      async cancel() {
        handle.cancelled = true;
      },
      async [Symbol.asyncDispose]() {
        handle.disposed = true;
      },
    };
    handles.push(handle);
    return handle;
  }

  return {
    created,
    resumed,
    handles,
    async listModels() {
      return models;
    },
    async createAgent(createOptions) {
      created.push(createOptions);
      return makeHandle(createOptions.agentId ?? FAKE_AGENT_ID);
    },
    async resumeAgent(agentId) {
      resumed.push(agentId);
      return makeHandle(agentId);
    },
  };
}

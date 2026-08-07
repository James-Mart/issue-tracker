import type {
  AgentDefinition,
  AgentOptions,
  InteractionUpdate,
  LocalAgentStore,
  ModelSelection,
  Run,
  RunResult,
  SDKAgent,
  SDKCustomTool,
  SDKMessage,
} from "@cursor/sdk";
import { JsonlLocalAgentStore } from "@cursor/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentSdk,
  toNestedEvent,
  type AgentStreamEvent,
} from "./agent-sdk.js";
import {
  buildScriptedStream,
  buildScriptedStreamWithAgentIdHint,
  buildScriptedStreamWithoutNested,
  NESTED_AGENT_ID,
  TASK_TOOL_CALL_ID,
} from "./agent-sdk.fake.js";
import { isAppendingRunEventsStore } from "./appending-run-events-store.js";
import { isCachedCheckpointsStore } from "./cached-checkpoints-store.js";

function expectCachedComposedStore(
  store: LocalAgentStore | undefined,
): asserts store is LocalAgentStore {
  expect(store).toBeDefined();
  expect(store).not.toBeInstanceOf(JsonlLocalAgentStore);
  expect(store).toEqual(
    expect.objectContaining({
      agents: expect.anything(),
      runs: expect.anything(),
      runEvents: expect.anything(),
      checkpoints: expect.anything(),
    }),
  );
  expect(isCachedCheckpointsStore(store!.checkpoints)).toBe(true);
  expect(isAppendingRunEventsStore(store!.runEvents)).toBe(true);
}

const MODEL: ModelSelection = { id: "composer-2.5" };
const STORE_DIR = "/data/conversations/my-conv/agent-state";

const SAMPLE_CUSTOM_TOOLS: Record<string, SDKCustomTool> = {
  delegate: {
    description: "Delegate to a nested agent",
    inputSchema: { type: "object", properties: {} },
    execute: async () => "done",
  },
};

// A step in a fake run: either a top-level stream message or an `onDelta`
// interaction the run fires while streaming.
type Step =
  | { kind: "message"; message: SDKMessage }
  | { kind: "delta"; update: InteractionUpdate };

interface FakeRun extends Run {
  cancel: ReturnType<typeof vi.fn>;
}

function makeFakeSdkAgent(
  script: Step[],
  onSend?: (run: FakeRun) => void,
): SDKAgent {
  return {
    agentId: "agent-1",
    model: undefined,
    async send(_message, options) {
      const onDelta = options?.onDelta;
      const run: FakeRun = {
        id: "run-1",
        agentId: "agent-1",
        status: "finished",
        supports: () => true,
        unsupportedReason: () => undefined,
        async *stream() {
          for (const step of script) {
            if (step.kind === "message") yield step.message;
            else await onDelta?.({ update: step.update });
          }
        },
        async conversation() {
          return [];
        },
        async wait(): Promise<RunResult> {
          return { id: "run-1", status: "finished" };
        },
        cancel: vi.fn(async () => {}),
        onDidChangeStatus: () => () => {},
      };
      onSend?.(run);
      return run;
    },
    close() {},
    async reload() {},
    async [Symbol.asyncDispose]() {},
    async listArtifacts() {
      return [];
    },
    async downloadArtifact() {
      return Buffer.from("");
    },
  };
}

async function drain(
  stream: AsyncIterable<AgentStreamEvent>,
): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe("createAgent", () => {
  it("always pins local runtime + config layers and forwards the api key", async () => {
    const createSdkAgent = vi.fn(
      async (_options: AgentOptions) => makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ createSdkAgent, apiKey: "key-abc" });

    await sdk.createAgent({
      cwd: "/repo",
      model: MODEL,
      agentId: "resume-me",
      storeDir: STORE_DIR,
    });

    expect(createSdkAgent).toHaveBeenCalledTimes(1);
    const options = createSdkAgent.mock.calls[0]![0];
    expect(options.local?.cwd).toBe("/repo");
    expect(options.local?.settingSources).toEqual([
      "user",
      "project",
      "plugins",
    ]);
    expectCachedComposedStore(options.local?.store);
    expect(options.apiKey).toBe("key-abc");
    expect(options.model).toEqual(MODEL);
    expect(options.agentId).toBe("resume-me");
  });

  it("wires a composed store with a cached checkpoints substore", async () => {
    const createSdkAgent = vi.fn(
      async (_options: AgentOptions) => makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ createSdkAgent, apiKey: "key-abc" });

    await sdk.createAgent({ cwd: "/repo", model: MODEL, storeDir: STORE_DIR });

    expectCachedComposedStore(createSdkAgent.mock.calls[0]![0].local?.store);
  });

  it("forwards the agents map unchanged to Agent.create", async () => {
    const agents: Record<string, AgentDefinition> = {
      "issue-tracker-implementor-composer": {
        description: "Implements one Task.",
        prompt: "You implement tasks.",
        model: { id: "composer-2.5" },
      },
      explore: {
        description: "Explores the codebase.",
        prompt: "You explore.",
      },
    };
    const createSdkAgent = vi.fn(
      async (_options: AgentOptions) => makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ createSdkAgent, apiKey: "key-abc" });

    await sdk.createAgent({
      cwd: "/repo",
      model: MODEL,
      storeDir: STORE_DIR,
      agents,
    });

    expect(createSdkAgent).toHaveBeenCalledTimes(1);
    expect(createSdkAgent.mock.calls[0]![0].agents).toBe(agents);
  });

  it("forwards customTools as local.customTools to Agent.create", async () => {
    const createSdkAgent = vi.fn(
      async (_options: AgentOptions) => makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ createSdkAgent, apiKey: "key-abc" });

    await sdk.createAgent({
      cwd: "/repo",
      model: MODEL,
      storeDir: STORE_DIR,
      customTools: SAMPLE_CUSTOM_TOOLS,
    });

    expect(createSdkAgent).toHaveBeenCalledTimes(1);
    expect(createSdkAgent.mock.calls[0]![0].local?.customTools).toBe(
      SAMPLE_CUSTOM_TOOLS,
    );
  });
});

describe("resumeAgent", () => {
  it("resumes by id and forwards the api key", async () => {
    const resumeSdkAgent = vi.fn(
      async (_id: string, _options?: Partial<AgentOptions>) =>
        makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ resumeSdkAgent, apiKey: "key-xyz" });

    const handle = await sdk.resumeAgent("agent-1", STORE_DIR, {
      cwd: "/repo",
      model: MODEL,
    });

    expect(handle.agentId).toBe("agent-1");
    expect(resumeSdkAgent).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        apiKey: "key-xyz",
        model: MODEL,
        agents: undefined,
        local: expect.objectContaining({
          cwd: "/repo",
          settingSources: ["user", "project", "plugins"],
          customTools: undefined,
        }),
      }),
    );
    expectCachedComposedStore(resumeSdkAgent.mock.calls[0]![1]?.local?.store);
  });

  // The workspace an agent runs in is also the workspace the SDK filed it
  // under, and a resume that names a different one is told the agent does not
  // exist. Resume therefore rebuilds the same local runtime create did rather
  // than letting the SDK fall back to the server's own `process.cwd()`.
  it("rebuilds the create-time local runtime so the resume stays in scope", async () => {
    const createSdkAgent = vi.fn(
      async (_options: AgentOptions) => makeFakeSdkAgent([]),
    );
    const resumeSdkAgent = vi.fn(
      async (_id: string, _options?: Partial<AgentOptions>) =>
        makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ createSdkAgent, resumeSdkAgent });

    await sdk.createAgent({
      cwd: "/repo",
      model: MODEL,
      storeDir: STORE_DIR,
      customTools: SAMPLE_CUSTOM_TOOLS,
    });
    await sdk.resumeAgent("agent-1", STORE_DIR, {
      cwd: "/repo",
      model: MODEL,
      customTools: SAMPLE_CUSTOM_TOOLS,
    });

    const createdLocal = createSdkAgent.mock.calls[0]![0].local;
    const resumedLocal = resumeSdkAgent.mock.calls[0]![1]?.local;
    expect(resumedLocal?.cwd).toEqual(createdLocal?.cwd);
    expect(resumedLocal?.settingSources).toEqual(createdLocal?.settingSources);
    expect(resumedLocal?.customTools).toBe(createdLocal?.customTools);
    expectCachedComposedStore(createdLocal?.store);
    expectCachedComposedStore(resumedLocal?.store);
  });

  it("wires a composed store with a cached checkpoints substore", async () => {
    const resumeSdkAgent = vi.fn(
      async (_id: string, _options?: Partial<AgentOptions>) =>
        makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ resumeSdkAgent, apiKey: "key-xyz" });

    await sdk.resumeAgent("agent-1", STORE_DIR, { cwd: "/repo", model: MODEL });

    expectCachedComposedStore(resumeSdkAgent.mock.calls[0]![1]?.local?.store);
  });

  it("forwards the agents map unchanged to Agent.resume", async () => {
    const agents: Record<string, AgentDefinition> = {
      "issue-tracker-implementor-composer": {
        description: "Implements one Task.",
        prompt: "You implement tasks.",
        model: { id: "composer-2.5" },
      },
      explore: {
        description: "Explores the codebase.",
        prompt: "You explore.",
      },
    };
    const resumeSdkAgent = vi.fn(
      async (_id: string, _options?: Partial<AgentOptions>) =>
        makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ resumeSdkAgent, apiKey: "key-xyz" });

    await sdk.resumeAgent("agent-1", STORE_DIR, {
      cwd: "/repo",
      model: MODEL,
      agents,
    });

    expect(resumeSdkAgent).toHaveBeenCalledTimes(1);
    expect(resumeSdkAgent.mock.calls[0]![1]?.agents).toBe(agents);
  });

  it("forwards customTools as local.customTools to Agent.resume", async () => {
    const resumeSdkAgent = vi.fn(
      async (_id: string, _options?: Partial<AgentOptions>) =>
        makeFakeSdkAgent([]),
    );
    const sdk = createAgentSdk({ resumeSdkAgent, apiKey: "key-xyz" });

    await sdk.resumeAgent("agent-1", STORE_DIR, {
      cwd: "/repo",
      model: MODEL,
      customTools: SAMPLE_CUSTOM_TOOLS,
    });

    expect(resumeSdkAgent).toHaveBeenCalledTimes(1);
    expect(resumeSdkAgent.mock.calls[0]![1]?.local?.customTools).toBe(
      SAMPLE_CUSTOM_TOOLS,
    );
  });
});

describe("listModels", () => {
  it("delegates to the SDK with the api key", async () => {
    const listSdkModels = vi.fn(async () => [
      { id: "composer-2.5", displayName: "Composer 2.5" },
    ]);
    const sdk = createAgentSdk({ listSdkModels, apiKey: "key-1" });

    const models = await sdk.listModels();

    expect(models).toHaveLength(1);
    expect(listSdkModels).toHaveBeenCalledWith({ apiKey: "key-1" });
  });
});

describe("send (merged stream)", () => {
  it("merges run.stream messages and onDelta nested updates in order", async () => {
    const msgA: SDKMessage = {
      type: "assistant",
      agent_id: "agent-1",
      run_id: "run-1",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    };
    const msgB: SDKMessage = {
      type: "status",
      agent_id: "agent-1",
      run_id: "run-1",
      status: "FINISHED",
    };
    const script: Step[] = [
      { kind: "message", message: msgA },
      {
        kind: "delta",
        update: {
          type: "tool-call-delta",
          callId: TASK_TOOL_CALL_ID,
          modelCallId: "mc-1",
          taskUpdate: { type: "text-delta", text: "nested" },
        } as InteractionUpdate,
      },
      { kind: "message", message: msgB },
    ];
    const sdk = createAgentSdk({
      createSdkAgent: async () => makeFakeSdkAgent(script),
    });

    const handle = await sdk.createAgent({ cwd: "/repo", model: MODEL, storeDir: STORE_DIR });
    const run = await handle.send("go");
    const events = await drain(run);
    expect(await run.wait()).toMatchObject({ id: "run-1", status: "finished" });
    expect(run.model).toBeUndefined();

    expect(events).toEqual([
      { kind: "message", message: msgA },
      {
        kind: "nested",
        callId: TASK_TOOL_CALL_ID,
        modelCallId: "mc-1",
        update: { type: "text-delta", text: "nested" },
      },
      { kind: "message", message: msgB },
    ]);
  });

  it("drops non-tool-call-delta and malformed interactions without throwing", async () => {
    const msg: SDKMessage = {
      type: "status",
      agent_id: "agent-1",
      run_id: "run-1",
      status: "FINISHED",
    };
    const script: Step[] = [
      // A top-level interaction that is not a tool-call-delta — dropped.
      { kind: "delta", update: { type: "text-delta", text: "top" } as InteractionUpdate },
      // A tool-call-delta with a non-string callId — dropped, must not throw.
      {
        kind: "delta",
        update: { type: "tool-call-delta", callId: 7 } as unknown as InteractionUpdate,
      },
      { kind: "message", message: msg },
    ];
    const sdk = createAgentSdk({
      createSdkAgent: async () => makeFakeSdkAgent(script),
    });

    const handle = await sdk.createAgent({ cwd: "/repo", model: MODEL, storeDir: STORE_DIR });
    const events = await drain(await handle.send("go"));

    expect(events).toEqual([{ kind: "message", message: msg }]);
  });

  it("forwards the per-send model to the SDK", async () => {
    const sdkSend = vi.fn(makeFakeSdkAgent([]).send);
    const sdkAgent = { ...makeFakeSdkAgent([]), send: sdkSend };
    const sdk = createAgentSdk({ createSdkAgent: async () => sdkAgent });

    const handle = await sdk.createAgent({ cwd: "/repo", model: MODEL, storeDir: STORE_DIR });
    await drain(await handle.send("go", { model: { id: "auto" } }));

    expect(sdkSend).toHaveBeenCalledWith(
      "go",
      expect.objectContaining({ model: { id: "auto" } }),
    );
  });

  it("surfaces the SDK run model on AgentRun", async () => {
    const runModel: ModelSelection = { id: "composer-2.5-fast" };
    const base = makeFakeSdkAgent([]);
    const sdkAgent: SDKAgent = {
      ...base,
      async send() {
        const run: FakeRun = {
          id: "run-model",
          agentId: "agent-1",
          status: "finished",
          model: runModel,
          supports: () => true,
          unsupportedReason: () => undefined,
          async *stream() {},
          async conversation() {
            return [];
          },
          async wait(): Promise<RunResult> {
            return { id: "run-model", status: "finished", model: runModel };
          },
          cancel: vi.fn(async () => {}),
          onDidChangeStatus: () => () => {},
        };
        return run;
      },
    };
    const sdk = createAgentSdk({ createSdkAgent: async () => sdkAgent });
    const handle = await sdk.createAgent({ cwd: "/repo", model: MODEL, storeDir: STORE_DIR });
    const run = await handle.send("go");
    expect(run.model).toEqual(runModel);
    await drain(run);
  });

  it("surfaces a started-then-errored wait result", async () => {
    const base = makeFakeSdkAgent([]);
    const sdkAgent: SDKAgent = {
      ...base,
      async send() {
        const run: FakeRun = {
          id: "run-err",
          agentId: "agent-1",
          status: "error",
          supports: () => true,
          unsupportedReason: () => undefined,
          async *stream() {},
          async conversation() {
            return [];
          },
          async wait(): Promise<RunResult> {
            return {
              id: "run-err",
              status: "error",
              error: { message: "boom", code: "X" },
            };
          },
          cancel: vi.fn(async () => {}),
          onDidChangeStatus: () => () => {},
        };
        return run;
      },
    };
    const sdk = createAgentSdk({ createSdkAgent: async () => sdkAgent });
    const handle = await sdk.createAgent({ cwd: "/repo", model: MODEL, storeDir: STORE_DIR });
    const run = await handle.send("go");
    await drain(run);
    expect(await run.wait()).toEqual({
      id: "run-err",
      status: "error",
      error: { message: "boom", code: "X" },
    });
  });
});

describe("cancel / dispose", () => {
  it("cancels the active run and disposes the underlying agent", async () => {
    let run: FakeRun | undefined;
    const asyncDispose = vi.fn(async () => {});
    const base = makeFakeSdkAgent([{ kind: "message", message: {
      type: "status",
      agent_id: "agent-1",
      run_id: "run-1",
      status: "RUNNING",
    } }], (r) => {
      run = r;
    });
    const sdkAgent: SDKAgent = { ...base, [Symbol.asyncDispose]: asyncDispose };
    const sdk = createAgentSdk({ createSdkAgent: async () => sdkAgent });

    const handle = await sdk.createAgent({ cwd: "/repo", model: MODEL, storeDir: STORE_DIR });
    const agentRun = await handle.send("go");
    const iterator = agentRun[Symbol.asyncIterator]();
    await iterator.next(); // consume one event so the pump is live

    await handle.cancel();
    expect(run?.cancel).toHaveBeenCalledTimes(1);

    // Drain the rest so the generator settles before disposing.
    while (!(await iterator.next()).done) {
      /* consume */
    }
    await handle[Symbol.asyncDispose]();
    expect(asyncDispose).toHaveBeenCalledTimes(1);
  });
});

describe("toNestedEvent", () => {
  it("returns null for a non-tool-call-delta update", () => {
    expect(
      toNestedEvent({ type: "text-delta", text: "x" } as InteractionUpdate),
    ).toBeNull();
  });

  it("lifts a well-formed tool-call-delta", () => {
    const nested = toNestedEvent({
      type: "tool-call-delta",
      callId: "c1",
      modelCallId: "m1",
      taskUpdate: { type: "thinking-completed", thinkingDurationMs: 3 },
    } as InteractionUpdate);
    expect(nested).toEqual({
      kind: "nested",
      callId: "c1",
      modelCallId: "m1",
      update: { type: "thinking-completed", thinkingDurationMs: 3 },
    });
  });

  it("drops a deeper tool-call-delta nesting level", () => {
    expect(
      toNestedEvent({
        type: "tool-call-delta",
        callId: "c1",
        modelCallId: "m1",
        taskUpdate: { type: "tool-call-delta" },
      } as unknown as InteractionUpdate),
    ).toBeNull();
  });
});

describe("fixture builder", () => {
  it("yields the scripted events in order with nested updates tagged to the Task callId", () => {
    const events = buildScriptedStream();

    const kinds = events.map((e) =>
      e.kind === "message" ? `msg:${e.message.type}` : `nested:${e.update.type}`,
    );
    expect(kinds).toEqual([
      "msg:assistant",
      "msg:thinking",
      "msg:tool_call",
      "msg:tool_call",
      "msg:task",
      "msg:status",
      "msg:usage",
      "msg:request",
      "msg:tool_call",
      "nested:text-delta",
      "nested:thinking-delta",
      "nested:thinking-completed",
      "nested:tool-call-started",
      "nested:tool-call-completed",
      "nested:step-started",
      "nested:step-completed",
      "msg:tool_call",
    ]);

    for (const event of events) {
      if (event.kind === "nested") {
        expect(event.callId).toBe(TASK_TOOL_CALL_ID);
      }
    }
  });

  it("emits no nested updates in the fallback variant", () => {
    const events = buildScriptedStreamWithoutNested();
    expect(events.some((e) => e.kind === "nested")).toBe(false);
  });

  it("carries the agentId hint on the completed Task tool call", () => {
    const events = buildScriptedStreamWithAgentIdHint();
    const taskCompleted = events.find(
      (e) =>
        e.kind === "message" &&
        e.message.type === "tool_call" &&
        e.message.call_id === TASK_TOOL_CALL_ID &&
        e.message.status === "completed",
    );
    expect(taskCompleted?.kind).toBe("message");
    if (taskCompleted?.kind === "message" && taskCompleted.message.type === "tool_call") {
      expect(taskCompleted.message.result).toMatchObject({
        agentId: NESTED_AGENT_ID,
      });
    }
  });
});

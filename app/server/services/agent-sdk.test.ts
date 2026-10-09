import type {
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
  PLAYWRIGHT_MCP_SERVERS,
  type AgentStreamEvent,
} from "./agent-sdk.js";
import { TASK_TOOL_CALL_ID } from "./agent-sdk.fake.js";
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

function expectPlaywrightMcpServers(options: AgentOptions): void {
  expect(options.mcpServers).toEqual(PLAYWRIGHT_MCP_SERVERS);
  const playwright = options.mcpServers?.playwright;
  expect(playwright && "args" in playwright ? playwright.args : undefined).toEqual(
    expect.arrayContaining(["--headless", "--isolated", "--browser", "chromium"]),
  );
}

// A step in a fake run: either a top-level stream message or an `onDelta`
// interaction the run fires while streaming.
type Step =
  | { kind: "message"; message: SDKMessage }
  | { kind: "delta"; update: InteractionUpdate };

function makeFakeSdkAgent(script: Step[]): SDKAgent {
  return {
    agentId: "agent-1",
    model: undefined,
    async send(_message, options) {
      const onDelta = options?.onDelta;
      const run: Run = {
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
        steer: vi.fn(async () => "complete_delivered" as const),
        onDidChangeStatus: () => () => {},
      };
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
    async getUsage() {
      return {
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        },
        runs: [],
      };
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
    expect(options.disallowedTools).toEqual(["task"]);
    expectPlaywrightMcpServers(options);
  });
});

describe("resumeAgent", () => {
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
    expect(createSdkAgent.mock.calls[0]![0].disallowedTools).toEqual(["task"]);
    expect(resumeSdkAgent.mock.calls[0]![1]?.disallowedTools).toEqual(["task"]);
    expectCachedComposedStore(createdLocal?.store);
    expectCachedComposedStore(resumedLocal?.store);
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
});

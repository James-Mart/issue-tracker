import type { SDKCustomToolResult } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import { type DelegateResult } from "./delegate-tool.js";
import {
  agentsDir,
  ASSISTANT_STREAM,
  cwd,
  loadNestedRunPublishModules,
  setupDelegateToolTest,
  setupNestedRunPublishTest,
  storeDir,
  teardownDelegateToolTest,
  teardownNestedRunPublishTest,
} from "./delegate-tool.fixtures.js";

function isDelegateResult(
  result: SDKCustomToolResult,
): result is DelegateResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "ok" in result &&
    typeof result.ok === "boolean" &&
    "agentId" in result &&
    typeof result.agentId === "string"
  );
}

function delegateResultOf(result: SDKCustomToolResult): DelegateResult {
  if (!isDelegateResult(result)) throw new Error("expected a delegate result");
  return result;
}

beforeEach(() => {
  setupDelegateToolTest();
});

afterEach(() => {
  teardownDelegateToolTest();
});

describe("delegate end records", () => {
  beforeEach(() => {
    setupNestedRunPublishTest();
  });

  afterEach(() => {
    teardownNestedRunPublishTest();
  });

  it("writes a completed end record on ok true", async () => {
    const { createConversation, readDelegations, createDelegateCustomTools: createTools } =
      await loadNestedRunPublishModules();
    const meta = await createConversation({
      title: "End completed",
      projectId: "platform",
      model: "composer-2.5",
    });

    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    const result = delegateResultOf(
      await customTools.delegate!.execute(
        { role: "pinned-role", prompt: "success" },
        { toolCallId: "call-success-end" },
      ),
    );
    expect(result.ok).toBe(true);

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]!.end).toMatchObject({ status: "completed" });
    expect(records[0]!.end!.failureClass).toBeUndefined();
  });

  it("writes an error end record with failureClass on reportFailure", async () => {
    const { createConversation, readDelegations, createDelegateCustomTools: createTools } =
      await loadNestedRunPublishModules();
    const meta = await createConversation({
      title: "End error",
      projectId: "platform",
      model: "composer-2.5",
    });

    const authMessage =
      "Authentication error. If you are logged in, try logging out and back in.";
    const fake = createFakeAgentSdk({
      stream: [],
      waitResult: {
        id: "run-auth-fail",
        status: "error",
        error: {
          message: authMessage,
          code: "AUTH_TOKEN_EXPIRED",
        },
      },
    });
    const customTools = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    const result = delegateResultOf(
      await customTools.delegate!.execute(
        { role: "pinned-role", prompt: "auth fail" },
        { toolCallId: "call-auth-end" },
      ),
    );
    expect(result).toMatchObject({
      ok: false,
      failureClass: "auth",
      isRetryable: true,
      message: authMessage,
    });

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]!.end).toMatchObject({
      status: "error",
      failureClass: "auth",
    });
  });

  it("writes an error end record when execute throws after the start record", async () => {
    const {
      createConversation,
      readConversation,
      readDelegations,
      createDelegateCustomTools: createTools,
    } = await loadNestedRunPublishModules();
    const meta = await createConversation({
      title: "End throw",
      projectId: "platform",
      model: "composer-2.5",
    });

    const baseFake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const wrappedSdk = {
      ...baseFake,
      async createAgent(options: Parameters<typeof baseFake.createAgent>[0]) {
        const agent = await baseFake.createAgent(options);
        const baseSend = agent.send.bind(agent);
        agent.send = async (prompt, sendOptions) => {
          const run = await baseSend(prompt, sendOptions);
          return {
            ...run,
            async *[Symbol.asyncIterator]() {
              for await (const event of run) {
                yield event;
              }
              throw new Error("unexpected stream failure");
            },
          };
        };
        return agent;
      },
    };
    const customTools = createTools({
      sdk: wrappedSdk,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    await expect(
      customTools.delegate!.execute(
        { role: "pinned-role", prompt: "throws after start" },
        { toolCallId: "call-throw-after-start" },
      ),
    ).rejects.toThrow("unexpected stream failure");

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]!.end).toMatchObject({ status: "error" });
    expect(records[0]!.end!.failureClass).toBeUndefined();

    const { transcript } = readConversation(meta.id);
    const delegateCalls = transcript.filter(
      (e) => e.type === "tool_call" && e.callId === "call-throw-after-start",
    );
    expect(delegateCalls).toEqual([
      expect.objectContaining({
        type: "tool_call",
        callId: "call-throw-after-start",
        name: "delegate",
        status: "error",
      }),
    ]);
  });

  it("writes no end record when execute throws before the start record", async () => {
    const { createConversation, readDelegations, createDelegateCustomTools: createTools } =
      await loadNestedRunPublishModules();
    const meta = await createConversation({
      title: "No end before start",
      projectId: "platform",
      model: "composer-2.5",
    });

    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    await expect(
      customTools.delegate!.execute(
        {
          role: "pinned-role",
          prompt: "orphan",
          resumeId: "no-such-agent",
        },
        { toolCallId: "call-before-start" },
      ),
    ).rejects.toThrow("delegate: unknown or unresumable agent no-such-agent");

    expect(readDelegations(meta.id)).toHaveLength(0);
  });
});

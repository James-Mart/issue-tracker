import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
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
});

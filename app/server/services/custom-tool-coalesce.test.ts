import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SDKCustomTool } from "@cursor/sdk";
import {
  setupRunSequenceTest,
  teardownRunSequenceTest,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

async function load() {
  const { createConversation, readConversation } = await import(
    "./conversations.js"
  );
  const { coalesceCustomTools } = await import("./custom-tool-coalesce.js");
  const { createDelegateCustomTools } = await import("./delegate-tool.js");
  return { createConversation, readConversation, coalesceCustomTools, createDelegateCustomTools };
}

function tool(body: () => Promise<{ value: string }>): SDKCustomTool {
  return { execute: async () => body() };
}

describe("coalesceCustomTools", () => {
  it("returns the in-flight result and does not run the tool again", async () => {
    const { createConversation, readConversation, coalesceCustomTools } =
      await load();
    const conversation = await createConversation({
      title: "Coalesce",
      projectId: "issue-tracker",
      model: "composer-2.5",
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const wrapped = coalesceCustomTools(
      {
        delegate: tool(async () => {
          runs += 1;
          await gate;
          return { value: "first" };
        }),
      },
      conversation.id,
    );

    const first = wrapped.delegate!.execute({}, { toolCallId: "call-1" });
    const second = wrapped.delegate!.execute({}, { toolCallId: "call-1" });
    expect(runs).toBe(1);
    release();
    await expect(first).resolves.toEqual({ value: "first" });
    await expect(second).resolves.toEqual({ value: "first" });
    expect(runs).toBe(1);

    const events = (await readConversation(conversation.id)).transcript.filter(
      (event) => event.type === "absorbed_replay",
    );
    expect(events).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        tool: "delegate",
        outcome: "joined-in-flight",
      }),
    ]);
  });

  it("returns the stored success or thrown failure after the call settles", async () => {
    const { createConversation, readConversation, coalesceCustomTools } =
      await load();
    const conversation = await createConversation({
      title: "Settled",
      projectId: "issue-tracker",
      model: "composer-2.5",
    });
    let runs = 0;
    const wrapped = coalesceCustomTools(
      {
        delegations: tool(async () => {
          runs += 1;
          return { value: "stored" };
        }),
      },
      conversation.id,
    );
    await wrapped.delegations!.execute({}, { toolCallId: "call-stored" });
    await expect(
      wrapped.delegations!.execute({}, { toolCallId: "call-stored" }),
    ).resolves.toEqual({ value: "stored" });
    expect(runs).toBe(1);

    const boom = new Error("tool failed");
    let failures = 0;
    const failing = coalesceCustomTools(
      {
        delegate: {
          execute: async () => {
            failures += 1;
            throw boom;
          },
        },
      },
      conversation.id,
    );
    await expect(
      failing.delegate!.execute({}, { toolCallId: "call-fail" }),
    ).rejects.toBe(boom);
    await expect(
      failing.delegate!.execute({}, { toolCallId: "call-fail" }),
    ).rejects.toBe(boom);
    expect(failures).toBe(1);

    const outcomes = (await readConversation(conversation.id)).transcript
      .filter((event) => event.type === "absorbed_replay")
      .map((event) => event.outcome);
    expect(outcomes).toEqual([
      "returned-stored-result",
      "returned-stored-result",
    ]);
  });

  it("runs the same toolCallId in another conversation and skips coalescing without a conversation id", async () => {
    const { createConversation, coalesceCustomTools } = await load();
    const first = await createConversation({
      title: "One",
      projectId: "issue-tracker",
      model: "composer-2.5",
    });
    const second = await createConversation({
      title: "Two",
      projectId: "issue-tracker",
      model: "composer-2.5",
    });
    let runs = 0;
    const body = tool(async () => {
      runs += 1;
      return { value: String(runs) };
    });
    const left = coalesceCustomTools({ delegate: body }, first.id);
    const right = coalesceCustomTools({ delegate: body }, second.id);
    await left.delegate!.execute({}, { toolCallId: "shared" });
    await expect(
      right.delegate!.execute({}, { toolCallId: "shared" }),
    ).resolves.toEqual({ value: "2" });
    expect(runs).toBe(2);

    const plain = coalesceCustomTools({ delegate: body }, undefined);
    await plain.delegate!.execute({}, { toolCallId: "shared" });
    await plain.delegate!.execute({}, { toolCallId: "shared" });
    expect(runs).toBe(4);

    await left.delegate!.execute({}, {});
    await left.delegate!.execute({}, {});
    expect(runs).toBe(6);
  });

  it("wraps every tool registered for a conversation", async () => {
    const { createConversation, readConversation, createDelegateCustomTools } =
      await load();
    const conversation = await createConversation({
      title: "Registered",
      projectId: "issue-tracker",
      model: "composer-2.5",
    });
    const tools = createDelegateCustomTools({
      sdk: {
        createAgent: async () => {
          throw new Error("replay must not spawn");
        },
        resumeAgent: async () => {
          throw new Error("replay must not resume");
        },
      },
      cwd: "/tmp",
      storeDir: "/tmp",
      conversationId: conversation.id,
    });
    await tools.delegations!.execute({}, { toolCallId: "list-1" });
    await tools.delegations!.execute({}, { toolCallId: "list-1" });
    const events = (await readConversation(conversation.id)).transcript.filter(
      (event) => event.type === "absorbed_replay",
    );
    expect(events).toEqual([
      expect.objectContaining({
        tool: "delegations",
        toolCallId: "list-1",
        outcome: "returned-stored-result",
      }),
    ]);
  });
});

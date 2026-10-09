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
});

import type { AgentStreamEvent } from "./agent-sdk.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  cancelConversationDelegations,
  createDelegateCustomTools,
  NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS,
} from "./delegate-tool.js";
import {
  agentsDir,
  ASSISTANT_STREAM,
  CONTROL_ONLY_STREAM,
  cwd,
  holdAfterStream,
  NESTED_RUN_IDS,
  setupDelegateToolTest,
  storeDir,
  teardownDelegateToolTest,
  waitForHandleSend,
} from "./delegate-tool.fixtures.js";

beforeEach(() => {
  setupDelegateToolTest();
});

afterEach(() => {
  teardownDelegateToolTest();
});

describe("nested run first-content deadline", () => {
  it("cancels at the threshold when only control events arrive", async () => {
    vi.useFakeTimers();
    try {
      const { hold, release } = holdAfterStream();
      const fake = createFakeAgentSdk({
        stream: CONTROL_ONLY_STREAM,
        holdAfterStream: hold,
      });
      const customTools = createDelegateCustomTools({
        sdk: fake,
        cwd,
        storeDir,
        agentsDir,
      });

      const executePromise = customTools.delegate!.execute(
        { role: "pinned-role", prompt: "control only" },
        {},
      );

      for (let i = 0; i < 50; i++) {
        if (fake.handles[0]?.sends.length === 1) break;
        await Promise.resolve();
      }
      expect(fake.handles[0]?.sends.length).toBe(1);

      await vi.advanceTimersByTimeAsync(NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS);

      const result = await executePromise;
      expect(result).toEqual({
        ok: false,
        failureClass: "stalled-before-first-token",
        isRetryable: true,
        message: expect.stringMatching(
          /delegate: nested run .* stalled before first content/,
        ),
        agentId: fake.handles[0]!.agentId,
      });
      expect(fake.handles[0]?.cancelled).toBe(true);
      release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not cancel after content even well past the threshold", async () => {
    vi.useFakeTimers();
    try {
      const { hold, release } = holdAfterStream();
      const fake = createFakeAgentSdk({
        stream: ASSISTANT_STREAM,
        holdAfterStream: hold,
      });
      const customTools = createDelegateCustomTools({
        sdk: fake,
        cwd,
        storeDir,
        agentsDir,
      });

      const executePromise = customTools.delegate!.execute(
        { role: "pinned-role", prompt: "has content" },
        {},
      );

      for (let i = 0; i < 50; i++) {
        if (fake.handles[0]?.sends.length === 1) break;
        await Promise.resolve();
      }

      await vi.advanceTimersByTimeAsync(
        NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS * 3,
      );

      release();
      const result = await executePromise;
      expect(result).toEqual({
        ok: true,
        agentId: fake.handles[0]!.agentId,
        reply: "On it.",
      });
      expect(fake.handles[0]?.cancelled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disarms the deadline on a nested frame alone", async () => {
    vi.useFakeTimers();
    try {
      const { hold, release } = holdAfterStream();
      const nestedOnly: AgentStreamEvent[] = [
        {
          kind: "nested",
          callId: "call-nested-1",
          modelCallId: "model-1",
          update: { type: "text-delta", text: "streaming" },
        },
      ];
      const fake = createFakeAgentSdk({
        stream: nestedOnly,
        holdAfterStream: hold,
      });
      const customTools = createDelegateCustomTools({
        sdk: fake,
        cwd,
        storeDir,
        agentsDir,
      });

      const executePromise = customTools.delegate!.execute(
        { role: "pinned-role", prompt: "nested frame" },
        {},
      );

      for (let i = 0; i < 50; i++) {
        if (fake.handles[0]?.sends.length === 1) break;
        await Promise.resolve();
      }

      await vi.advanceTimersByTimeAsync(
        NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS * 2,
      );

      release();
      const result = await executePromise;
      expect(result).toEqual({
        ok: true,
        agentId: fake.handles[0]!.agentId,
        reply: "",
      });
      expect(fake.handles[0]?.cancelled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disarms the deadline on an unrecognised message type", async () => {
    vi.useFakeTimers();
    try {
      const { hold, release } = holdAfterStream();
      const unknownTypeStream: AgentStreamEvent[] = [
        {
          kind: "message",
          message: {
            type: "future-sdk-event" as "assistant",
            ...NESTED_RUN_IDS,
          },
        },
      ];
      const fake = createFakeAgentSdk({
        stream: unknownTypeStream,
        holdAfterStream: hold,
      });
      const customTools = createDelegateCustomTools({
        sdk: fake,
        cwd,
        storeDir,
        agentsDir,
      });

      const executePromise = customTools.delegate!.execute(
        { role: "pinned-role", prompt: "unknown type" },
        {},
      );

      for (let i = 0; i < 50; i++) {
        if (fake.handles[0]?.sends.length === 1) break;
        await Promise.resolve();
      }

      await vi.advanceTimersByTimeAsync(
        NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS * 2,
      );

      release();
      const result = await executePromise;
      expect(result).toEqual({
        ok: true,
        agentId: fake.handles[0]!.agentId,
        reply: "",
      });
      expect(fake.handles[0]?.cancelled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still reports conversation cancel as cancelled, not stalled", async () => {
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const conversationId = "conv-first-content-cancel";
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId,
    });

    const running = customTools.delegate!.execute(
      { role: "pinned-role", prompt: "will cancel" },
      {},
    );
    await waitForHandleSend(fake, 0);
    await new Promise((r) => setTimeout(r, 50));

    await cancelConversationDelegations(conversationId);
    const result = await running;
    expect(result).toMatchObject({
      ok: false,
      failureClass: "cancelled",
    });

    releaseHold();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  createDelegateCustomTools,
  NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS,
} from "./delegate-tool.js";
import {
  agentsDir,
  CONTROL_ONLY_STREAM,
  cwd,
  holdAfterStream,
  setupDelegateToolTest,
  storeDir,
  teardownDelegateToolTest,
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
});

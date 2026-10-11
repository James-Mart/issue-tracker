import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAgentSdk, type FakeSend } from "./agent-sdk.fake.js";
import {
  createDelegateCustomTools,
  MAX_CONCURRENT_DELEGATIONS_GLOBAL,
  MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION,
  MAX_DELEGATION_DEPTH,
} from "./delegate-tool.js";
import {
  agentsDir,
  ASSISTANT_STREAM,
  cwd,
  setupDelegateToolTest,
  storeDir,
  teardownDelegateToolTest,
  waitForHandleSend,
} from "./delegate-tool.fixtures.js";
import { resolveModelSelection } from "./model-selection.js";
import { loadRoleBody } from "./role-bodies.js";

function sentText(send: FakeSend): string {
  return typeof send.message === "string" ? send.message : send.message.text;
}

beforeEach(() => {
  setupDelegateToolTest();
});

afterEach(() => {
  teardownDelegateToolTest();
});

describe("createDelegateCustomTools", () => {
  it("creates a nested agent on the role's mapped pin with the role body prepended", async () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    const roleBody = loadRoleBody("pinned-role", agentsDir);
    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "do the thing" },
      {},
    );

    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]!.model).toEqual(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    expect(fake.handles[0]!.sends).toHaveLength(1);
    expect(sentText(fake.handles[0]!.sends[0]!).startsWith(roleBody)).toBe(true);
    expect(sentText(fake.handles[0]!.sends[0]!).endsWith("do the thing")).toBe(
      true,
    );
    expect(result).toEqual({
      ok: true,
      agentId: fake.handles[0]!.agentId,
      reply: "On it.",
    });
    expect(fake.created[0]!.agentId).toBe(fake.handles[0]!.agentId);
    expect(fake.created[0]!.storeDir).toBe(
      join(storeDir, "nested", fake.handles[0]!.agentId),
    );
  });

  it("allows delegation through depth 3 and refuses depth 4", async () => {
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });
    const delegate = customTools.delegate!;

    const depth1 = delegate.execute(
      { role: "pinned-role", prompt: "depth 1" },
      {},
    );
    await waitForHandleSend(fake, 0);

    const delegate2 = fake.created[0]!.customTools!.delegate!;
    const depth2 = delegate2.execute(
      { role: "pinned-role", prompt: "depth 2" },
      {},
    );
    await waitForHandleSend(fake, 1);

    const delegate3 = fake.created[1]!.customTools!.delegate!;
    const depth3 = delegate3.execute(
      { role: "pinned-role", prompt: "depth 3" },
      {},
    );
    await waitForHandleSend(fake, 2);

    expect(fake.created).toHaveLength(MAX_DELEGATION_DEPTH);

    const delegate4 = fake.created[2]!.customTools!.delegate!;
    await expect(
      delegate4.execute({ role: "pinned-role", prompt: "depth 4" }, {}),
    ).rejects.toThrow(
      `delegate: maximum delegation depth is ${MAX_DELEGATION_DEPTH} (attempted depth ${MAX_DELEGATION_DEPTH + 1})`,
    );
    expect(fake.created).toHaveLength(MAX_DELEGATION_DEPTH);

    releaseHold();
    await Promise.all([depth1, depth2, depth3]);
  });

  it("starts up to the per-conversation concurrency cap and FIFO-queues the rest", async () => {
    expect(MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION).toBe(6);
    expect(MAX_CONCURRENT_DELEGATIONS_GLOBAL).toBe(24);

    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: "conv-concurrency-a",
    });
    const delegate = customTools.delegate!;
    const cap = MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION;

    const running = Array.from({ length: cap }, (_, i) =>
      delegate.execute({ role: "pinned-role", prompt: `slot ${i}` }, {}),
    );
    for (let i = 0; i < cap; i++) {
      await waitForHandleSend(fake, i);
    }
    expect(fake.created).toHaveLength(cap);

    const seventh = delegate.execute(
      { role: "pinned-role", prompt: "queued" },
      {},
    );
    // Give the 7th a chance to start if the cap were broken.
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.created).toHaveLength(cap);

    // Free one slot: complete the held runs, then only the first finisher
    // releases before the others — releaseHold unblocks all iterators at once,
    // so all six finish and the seventh starts as slots free.
    releaseHold();
    await Promise.all(running);
    await waitForHandleSend(fake, cap);
    expect(fake.created).toHaveLength(cap + 1);
    await seventh;
  });
});

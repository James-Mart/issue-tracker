import { rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { AgentOptions } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSdk } from "./agent-sdk.js";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  cancelConversationDelegations,
  conversationDelegationOutstandingForTests,
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

beforeEach(() => {
  setupDelegateToolTest();
});

afterEach(() => {
  teardownDelegateToolTest();
});

describe("createDelegateCustomTools", () => {
  it("exposes the bug-filing tool alongside the delegation tools", () => {
    const customTools = createDelegateCustomTools({
      sdk: createFakeAgentSdk({ stream: ASSISTANT_STREAM }),
      cwd,
      storeDir,
      agentsDir,
    });

    expect(Object.keys(customTools).sort()).toEqual([
      "delegate",
      "delegations",
      "file_cursor_sdk_bug",
    ]);
  });

  it("exposes agent-stack tools when the conversation and cursor id getter are set", () => {
    const customTools = createDelegateCustomTools({
      sdk: createFakeAgentSdk({ stream: ASSISTANT_STREAM }),
      cwd,
      storeDir,
      agentsDir,
      conversationId: "app-conv",
      getCursorConversationId: () => "cursor-1",
    });

    expect(Object.keys(customTools).sort()).toEqual([
      "agent_stack_start",
      "agent_stack_stop",
      "delegate",
      "delegations",
      "file_cursor_sdk_bug",
    ]);
  });

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
    expect(fake.handles[0]!.sends[0]!.message.startsWith(roleBody)).toBe(true);
    expect(fake.handles[0]!.sends[0]!.message.endsWith("do the thing")).toBe(
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

  it("disallows Task spawn on nested create and resume while delegate still returns agentId and reply", async () => {
    const createSdkAgent = vi.fn(async (options: AgentOptions) => {
      expect(options.disallowedTools).toEqual(["task"]);
      expect(options.local?.customTools?.delegate).toBeDefined();
      const agentId = options.agentId ?? "agent-nested";
      return {
        agentId,
        model: undefined,
        async send() {
          return {
            id: "run-nested",
            agentId,
            status: "finished" as const,
            supports: () => true,
            unsupportedReason: () => undefined,
            async *stream() {
              for (const event of ASSISTANT_STREAM) {
                if (event.kind === "message") yield event.message;
              }
            },
            async conversation() {
              return [];
            },
            async wait() {
              return { id: "run-nested", status: "finished" as const };
            },
            cancel: vi.fn(async () => {}),
            onDidChangeStatus: () => () => {},
          };
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
    });
    const resumeSdkAgent = vi.fn(async (agentId: string, options?: Partial<AgentOptions>) => {
      expect(options?.disallowedTools).toEqual(["task"]);
      expect(options?.local?.customTools?.delegate).toBeDefined();
      return createSdkAgent.mock.results[0]!.value;
    });
    const sdk = createAgentSdk({ createSdkAgent, resumeSdkAgent, apiKey: undefined });
    const customTools = createDelegateCustomTools({
      sdk,
      cwd,
      storeDir,
      agentsDir,
    });

    const first = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "first turn" },
      {},
    );
    expect(first).toEqual({
      ok: true,
      agentId: expect.any(String),
      reply: "On it.",
    });
    expect(Object.keys(first)).toEqual(["ok", "agentId", "reply"]);
    expect(createSdkAgent).toHaveBeenCalledTimes(1);

    const second = await customTools.delegate!.execute(
      {
        role: "pinned-role",
        prompt: "second turn",
        resumeId: first.agentId as string,
      },
      {},
    );
    expect(second).toEqual({
      ok: true,
      agentId: first.agentId,
      reply: "On it.",
    });
    expect(resumeSdkAgent).toHaveBeenCalledTimes(1);
    expect(createSdkAgent).toHaveBeenCalledTimes(1);
  });

  it("resumes an existing nested agent with resumeId instead of creating", async () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });
    const roleBody = loadRoleBody("pinned-role", agentsDir);

    const first = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "first turn" },
      {},
    );
    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toHaveLength(0);

    const second = await customTools.delegate!.execute(
      {
        role: "pinned-role",
        prompt: "second turn",
        resumeId: first.agentId as string,
      },
      {},
    );

    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toEqual([
      {
        agentId: first.agentId,
        storeDir: join(storeDir, "nested", first.agentId as string),
        options: {
          // Re-entry names the same workspace the spawn ran in. The SDK files
          // an agent under its workspace and looks it up the same way, so a
          // resume that leaves this out lands outside the agent's scope and is
          // told it does not exist.
          cwd,
          // And it re-states the role's pin, which a resumed agent does not
          // carry on its own.
          model: resolveModelSelection("cursor-grok-4.5-high-fast"),
          customTools: expect.any(Object),
        },
      },
    ]);
    expect(fake.handles[1]!.sends).toHaveLength(1);
    expect(fake.handles[1]!.sends[0]!.message).toBe("second turn");
    expect(fake.handles[1]!.sends[0]!.message.startsWith(roleBody)).toBe(
      false,
    );
    expect(second).toEqual({
      ok: true,
      agentId: first.agentId,
      reply: "On it.",
    });

    const third = await customTools.delegate!.execute(
      {
        role: "pinned-role",
        prompt: "third turn",
        resumeId: first.agentId as string,
      },
      {},
    );
    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toHaveLength(2);
    expect(third.agentId).toBe(first.agentId);
    expect(fake.handles[2]!.sends[0]!.message).toBe("third turn");
  });

  it("errors on an unknown resumeId without creating a fresh agent", async () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    await expect(
      customTools.delegate!.execute(
        {
          role: "pinned-role",
          prompt: "orphan",
          resumeId: "no-such-agent",
        },
        {},
      ),
    ).rejects.toThrow("delegate: unknown or unresumable agent no-such-agent");
    expect(fake.created).toHaveLength(0);
    expect(fake.resumed).toHaveLength(0);
  });

  it("errors when resumeAgent fails without falling back to create", async () => {
    const fake = createFakeAgentSdk({
      stream: ASSISTANT_STREAM,
      resumeError: new Error("agent not found in store"),
    });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    const first = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "first turn" },
      {},
    );
    expect(fake.created).toHaveLength(1);

    await expect(
      customTools.delegate!.execute(
        {
          role: "pinned-role",
          prompt: "retry",
          resumeId: first.agentId as string,
        },
        {},
      ),
    ).rejects.toThrow(
      /delegate: unknown or unresumable agent .*agent not found in store/,
    );
    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toHaveLength(1);
  });

  it("passes a nesting-capable delegate tool to nested agents", async () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: "app-conv",
      getCursorConversationId: () => "root-cursor",
    });

    await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "outer work" },
      {},
    );

    const nestedTools = fake.created[0]!.customTools;
    expect(nestedTools?.delegate).toBeDefined();
    expect(nestedTools?.agent_stack_start).toBeDefined();
    expect(nestedTools?.agent_stack_stop).toBeDefined();

    const nestedResult = await nestedTools!.delegate!.execute(
      { role: "pinned-role", prompt: "inner work" },
      {},
    );

    expect(fake.created).toHaveLength(2);
    expect(fake.created[1]!.customTools?.delegate).toBeDefined();
    expect(fake.created[1]!.customTools?.agent_stack_start).toBeDefined();
    expect(fake.created[1]!.model).toEqual(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    expect(nestedResult).toEqual({
      ok: true,
      agentId: fake.handles[1]!.agentId,
      reply: "On it.",
    });
    expect(nestedResult.agentId).not.toBe(fake.handles[0]!.agentId);
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

  it("does not let one conversation's concurrency limit queue another", async () => {
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const toolsA = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: "conv-cap-a",
    });
    const toolsB = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: "conv-cap-b",
    });
    const cap = MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION;

    const fromA = Array.from({ length: cap }, (_, i) =>
      toolsA.delegate!.execute(
        { role: "pinned-role", prompt: `a-${i}` },
        {},
      ),
    );
    for (let i = 0; i < cap; i++) {
      await waitForHandleSend(fake, i);
    }
    expect(fake.created).toHaveLength(cap);

    const fromB = toolsB.delegate!.execute(
      { role: "pinned-role", prompt: "b-unaffected" },
      {},
    );
    await waitForHandleSend(fake, cap);
    expect(fake.created).toHaveLength(cap + 1);

    releaseHold();
    await Promise.all([...fromA, fromB]);
  });

  it("releases the concurrency slot when nested-store setup fails", async () => {
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
      conversationId: "conv-slot-leak",
    });
    const delegate = customTools.delegate!;
    const heldCount = MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION - 1;

    const held = Array.from({ length: heldCount }, (_, i) =>
      delegate.execute({ role: "pinned-role", prompt: `held-${i}` }, {}),
    );
    for (let i = 0; i < heldCount; i++) {
      await waitForHandleSend(fake, i);
    }

    // Block mkdirSync(storeDir/nested/<uuid>) by making `nested` a file.
    rmSync(join(storeDir, "nested"), { recursive: true, force: true });
    writeFileSync(join(storeDir, "nested"), "not-a-directory");
    await expect(
      delegate.execute({ role: "pinned-role", prompt: "setup fails" }, {}),
    ).rejects.toThrow();
    expect(fake.created).toHaveLength(heldCount);

    rmSync(join(storeDir, "nested"), { force: true });
    const afterFailure = delegate.execute(
      { role: "pinned-role", prompt: "slot freed" },
      {},
    );
    await waitForHandleSend(fake, heldCount);
    expect(fake.created).toHaveLength(heldCount + 1);

    releaseHold();
    await Promise.all([...held, afterFailure]);
  });

  it("returns structured auth failure when wait() resolves error with auth text", async () => {
    const authMessage =
      "Authentication error. If you are logged in, try logging out and back in.";
    const fake = createFakeAgentSdk({
      stream: [],
      waitResult: {
        id: "run-auth-fail",
        status: "error",
        error: {
          message: authMessage,
          isRetryable: true,
        },
      },
    });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "auth fail" },
      {},
    );

    expect(result).toEqual({
      ok: false,
      failureClass: "auth",
      isRetryable: true,
      message: authMessage,
      agentId: fake.handles[0]!.agentId,
    });
  });

  it("returns structured cancelled failure when wait() resolves cancelled", async () => {
    const fake = createFakeAgentSdk({
      stream: ASSISTANT_STREAM,
      waitResult: {
        id: "run-cancelled",
        status: "cancelled",
      },
    });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "cancelled run" },
      {},
    );

    expect(result).toMatchObject({
      ok: false,
      failureClass: "cancelled",
      isRetryable: false,
      agentId: fake.handles[0]!.agentId,
    });
    expect(result).toHaveProperty(
      "message",
      expect.stringMatching(/delegate: nested run .* was cancelled/),
    );
  });

  it("throws for an unknown role", async () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    await expect(
      customTools.delegate!.execute(
        { role: "no-such-role", prompt: "orphan" },
        {},
      ),
    ).rejects.toThrow();
    expect(fake.created).toHaveLength(0);
  });

  it("returns ok true with reply on a successful delegation", async () => {
    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
    });

    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "success" },
      {},
    );

    expect(result).toEqual({
      ok: true,
      agentId: fake.handles[0]!.agentId,
      reply: "On it.",
    });
  });

  it("cancels in-flight nested runs and drops queued waiters for the conversation", async () => {
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const fake = createFakeAgentSdk({ hold, stream: [] });
    const conversationId = "conv-cascade-cancel";
    const customTools = createDelegateCustomTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId,
    });
    const delegate = customTools.delegate!;
    const cap = MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION;

    const running = Array.from({ length: cap }, (_, i) =>
      delegate.execute({ role: "pinned-role", prompt: `inflight-${i}` }, {}),
    );
    for (let i = 0; i < cap; i++) {
      await waitForHandleSend(fake, i);
    }

    const queued = delegate.execute(
      { role: "pinned-role", prompt: "queued" },
      {},
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.created).toHaveLength(cap);
    expect(conversationDelegationOutstandingForTests(conversationId)).toEqual(
      {
        inFlight: cap,
        queued: 1,
        nestedTracked: cap,
      },
    );

    const cancelled = await cancelConversationDelegations(conversationId);
    expect(cancelled).toBe(cap);

    await expect(queued).rejects.toThrow("delegate: conversation cancelled");
    await Promise.all(
      running.map(async (p) => {
        const result = await p;
        expect(result).toMatchObject({
          ok: false,
          failureClass: "cancelled",
        });
      }),
    );

    for (let i = 0; i < cap; i++) {
      expect(fake.handles[i]?.cancelled).toBe(true);
    }
    expect(fake.created).toHaveLength(cap);
    expect(conversationDelegationOutstandingForTests(conversationId)).toEqual(
      {
        inFlight: 0,
        queued: 0,
        nestedTracked: 0,
      },
    );

    releaseHold();
  });
});

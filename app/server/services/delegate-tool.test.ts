import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentOptions } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "./agent-sdk.js";
import { createAgentSdk } from "./agent-sdk.js";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import type { ConversationFrame } from "./conversation-stream.js";
import {
  cancelConversationDelegations,
  conversationDelegationOutstandingForTests,
  createDelegateCustomTools,
  MAX_CONCURRENT_DELEGATIONS_GLOBAL,
  MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION,
  MAX_DELEGATION_DEPTH,
  NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS,
  NESTED_RUN_HEARTBEAT_MS,
  resetDelegationConcurrencyForTests,
} from "./delegate-tool.js";
import {
  formatEffectiveModel,
  resolveModelSelection,
} from "./model-selection.js";
import { loadRoleBody } from "./role-bodies.js";

let agentsDir: string;
let storeDir: string;
let cwd: string;

function writeAgent(name: string, content: string): void {
  writeFileSync(join(agentsDir, name), content, "utf8");
}

const ASSISTANT_STREAM: AgentStreamEvent[] = [
  {
    kind: "message",
    message: {
      type: "assistant",
      agent_id: "agent-nested",
      run_id: "run-nested",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "On it." }],
      },
    },
  },
];

const NESTED_RUN_IDS = {
  agent_id: "agent-nested",
  run_id: "run-nested",
} as const;

const CONTROL_ONLY_STREAM: AgentStreamEvent[] = [
  {
    kind: "message",
    message: {
      type: "request",
      ...NESTED_RUN_IDS,
      request_id: "req-1",
    },
  },
  {
    kind: "message",
    message: {
      type: "status",
      ...NESTED_RUN_IDS,
      status: "RUNNING",
    },
  },
  {
    kind: "message",
    message: {
      type: "usage",
      ...NESTED_RUN_IDS,
      usage: {
        inputTokens: 1,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1,
      },
    },
  },
];

function holdAfterStream(): { hold: Promise<void>; release: () => void } {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { hold, release };
}

beforeEach(() => {
  agentsDir = mkdtempSync(join(tmpdir(), "issue-delegate-agents-"));
  storeDir = mkdtempSync(join(tmpdir(), "issue-delegate-store-"));
  cwd = mkdtempSync(join(tmpdir(), "issue-delegate-cwd-"));
  mkdirSync(agentsDir, { recursive: true });

  writeAgent(
    "pinned-role.md",
    `---
name: pinned-role
model: cursor-grok-4.5-high-fast
description: A pinned role for delegate tests.
---

You are the pinned role.

Follow the checklist.`,
  );
});

afterEach(() => {
  resetDelegationConcurrencyForTests();
  rmSync(agentsDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

async function waitForHandleSend(
  fake: ReturnType<typeof createFakeAgentSdk>,
  handleIndex: number,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (fake.handles[handleIndex]?.sends.length === 1) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for handle[${handleIndex}] send`);
}

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
    expect(fake.handles[0]!.sends[0]!.prompt.startsWith(roleBody)).toBe(true);
    expect(fake.handles[0]!.sends[0]!.prompt.endsWith("do the thing")).toBe(
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
    expect(fake.handles[1]!.sends[0]!.prompt).toBe("second turn");
    expect(fake.handles[1]!.sends[0]!.prompt.startsWith(roleBody)).toBe(
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
    expect(fake.handles[2]!.sends[0]!.prompt).toBe("third turn");
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

    await cancelConversationDelegations(conversationId);

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

describe("delegate publishes nested run frames", () => {
  let root: string;
  let issuesRoot: string;
  let workspaceDir: string;

  const AT = "2026-07-25T12:00:00.000Z";

  beforeEach(() => {
    // Nest issues/ under a unique root so conversations/ is not shared at
    // tmpdir()/conversations with other parallel Vitest workers.
    root = mkdtempSync(join(tmpdir(), "issue-delegate-publish-"));
    issuesRoot = join(root, "issues");
    mkdirSync(issuesRoot, { recursive: true });
    workspaceDir = mkdtempSync(join(tmpdir(), "issue-delegate-ws-"));
    mkdirSync(join(workspaceDir, ".git"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesRoot);
    mkdirSync(join(issuesRoot, "platform"), { recursive: true });
    writeFileSync(
      join(issuesRoot, "platform", "issue.json"),
      JSON.stringify({
        id: "platform",
        kind: "project",
        title: "Platform",
        workspace: workspaceDir,
        createdAt: AT,
        updatedAt: AT,
      }),
    );
  });

  afterEach(() => {
    resetDelegationConcurrencyForTests();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  async function load() {
    const { createConversation, readConversation, readDelegations, updateMeta } =
      await import("./conversations.js");
    const { conversationsDir } = await import("../config.js");
    const { subscribeFrames } = await import("./conversation-stream.js");
    const { createDelegateCustomTools: createTools } = await import(
      "./delegate-tool.js"
    );
    return {
      createConversation,
      readConversation,
      readDelegations,
      updateMeta,
      conversationsDir,
      subscribeFrames,
      createDelegateCustomTools: createTools,
    };
  }

  async function waitForSend(
    fake: ReturnType<typeof createFakeAgentSdk>,
    handleIndex: number,
  ): Promise<void> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (fake.handles[handleIndex]?.sends.length === 1) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out waiting for handle[${handleIndex}] send`);
  }

  it("persists a terminal delegate tool_call when a caller error throws with pipeline context", async () => {
    const {
      createConversation,
      readConversation,
      createDelegateCustomTools: createTools,
    } = await load();
    const meta = await createConversation({
      title: "Throw persists",
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
        { toolCallId: "call-throw-delegate" },
      ),
    ).rejects.toThrow("delegate: unknown or unresumable agent no-such-agent");

    const { transcript } = readConversation(meta.id);
    const delegateCalls = transcript.filter(
      (e) => e.type === "tool_call" && e.callId === "call-throw-delegate",
    );
    expect(delegateCalls).toEqual([
      expect.objectContaining({
        type: "tool_call",
        callId: "call-throw-delegate",
        name: "delegate",
        status: "error",
        result: {
          status: "error",
          message: "delegate: unknown or unresumable agent no-such-agent",
        },
      }),
    ]);
  });

  it("emits subagent_update frames with delegationId and effective model", async () => {
    const {
      createConversation,
      readConversation,
      subscribeFrames,
      createDelegateCustomTools: createTools,
    } = await load();
    const meta = await createConversation({
      title: "Delegate publish",
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

    const frames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      frames.push(frame);
    });

    await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "publish me" },
      { toolCallId: "call-delegate-1" },
    );
    unsubscribe();

    const expectedModel = formatEffectiveModel(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    const nested = frames.filter(
      (f): f is ConversationFrame & { event: { type: "subagent_update" } } =>
        f.event.type === "subagent_update",
    );
    expect(nested.length).toBeGreaterThan(0);
    expect(
      nested.every(
        (f) =>
          f.event.parentCallId === "call-delegate-1" &&
          typeof f.event.delegationId === "string" &&
          f.event.delegationId.length > 0 &&
          f.event.model === expectedModel &&
          f.event.parentDelegationId === undefined,
      ),
    ).toBe(true);

    const { transcript } = readConversation(meta.id);
    const persisted = transcript.filter((e) => e.type === "subagent_update");
    expect(persisted.length).toBeGreaterThan(0);
    expect(
      persisted.every((e) => e.delegationId && e.model === expectedModel),
    ).toBe(true);
  });

  it("records the outer run as parentDelegationId for a nested delegation", async () => {
    const {
      createConversation,
      subscribeFrames,
      createDelegateCustomTools: createTools,
    } = await load();
    const meta = await createConversation({
      title: "Nested parentage",
      projectId: "platform",
      model: "composer-2.5",
    });

    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({ hold, stream: ASSISTANT_STREAM });
    const customTools = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    const frames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      frames.push(frame);
    });

    const outerPromise = customTools.delegate!.execute(
      { role: "pinned-role", prompt: "outer" },
      { toolCallId: "call-outer" },
    );
    await waitForSend(fake, 0);

    // Nest through the outer agent's bound delegate tools while the outer run
    // is still held mid-stream. Both sends share the fake's hold, so await
    // them only after release.
    const innerPromise = fake.created[0]!.customTools!.delegate!.execute(
      { role: "pinned-role", prompt: "inner" },
      { toolCallId: "call-inner" },
    );
    await waitForSend(fake, 1);

    release();
    await Promise.all([outerPromise, innerPromise]);
    unsubscribe();

    const byParent = (callId: string) =>
      frames.filter(
        (f): f is ConversationFrame & { event: { type: "subagent_update" } } =>
          f.event.type === "subagent_update" &&
          f.event.parentCallId === callId,
      );

    const outerFrames = byParent("call-outer");
    const innerFrames = byParent("call-inner");
    expect(outerFrames.length).toBeGreaterThan(0);
    expect(innerFrames.length).toBeGreaterThan(0);

    const outerDelegationId = outerFrames[0]!.event.delegationId;
    expect(outerDelegationId).toEqual(expect.any(String));
    expect(
      outerFrames.every((f) => f.event.parentDelegationId === undefined),
    ).toBe(true);
    expect(
      innerFrames.every(
        (f) => f.event.parentDelegationId === outerDelegationId,
      ),
    ).toBe(true);
    expect(innerFrames[0]!.event.delegationId).not.toBe(outerDelegationId);
  });

  it("emits live-only liveness heartbeats for a silent in-flight nested run", async () => {
    vi.useFakeTimers();
    try {
      const {
        createConversation,
        readConversation,
        subscribeFrames,
        createDelegateCustomTools: createTools,
      } = await load();
      const meta = await createConversation({
        title: "Liveness heartbeat",
        projectId: "platform",
        model: "composer-2.5",
      });

      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fake = createFakeAgentSdk({ hold, stream: [] });
      const customTools = createTools({
        sdk: fake,
        cwd,
        storeDir,
        agentsDir,
        conversationId: meta.id,
      });

      const frames: ConversationFrame[] = [];
      const unsubscribe = subscribeFrames(meta.id, (frame) => {
        frames.push(frame);
      });

      const executePromise = customTools.delegate!.execute(
        { role: "pinned-role", prompt: "stay quiet" },
        { toolCallId: "call-silent" },
      );

      for (let i = 0; i < 50; i++) {
        if (fake.handles[0]?.sends.length === 1) break;
        await Promise.resolve();
      }
      expect(fake.handles[0]?.sends.length).toBe(1);

      await vi.advanceTimersByTimeAsync(NESTED_RUN_HEARTBEAT_MS);
      await vi.advanceTimersByTimeAsync(NESTED_RUN_HEARTBEAT_MS);

      const livenessDuring = frames.filter(
        (
          f,
        ): f is ConversationFrame & {
          event: {
            type: "subagent_update";
            step: { kind: "liveness"; elapsedMs: number };
          };
        } =>
          f.event.type === "subagent_update" &&
          f.event.step.kind === "liveness",
      );
      expect(livenessDuring.length).toBeGreaterThanOrEqual(2);
      expect(livenessDuring.every((f) => f.persist === false)).toBe(true);
      expect(
        livenessDuring.every(
          (f) =>
            f.event.parentCallId === "call-silent" &&
            typeof f.event.delegationId === "string" &&
            f.event.delegationId.length > 0,
        ),
      ).toBe(true);
      const elapsed = livenessDuring.map((f) => f.event.step.elapsedMs);
      for (let i = 1; i < elapsed.length; i++) {
        expect(elapsed[i]!).toBeGreaterThan(elapsed[i - 1]!);
      }

      const countAtRelease = livenessDuring.length;
      release();
      await executePromise;
      unsubscribe();

      await vi.advanceTimersByTimeAsync(NESTED_RUN_HEARTBEAT_MS * 3);
      const livenessAfter = frames.filter(
        (f) =>
          f.event.type === "subagent_update" &&
          f.event.step.kind === "liveness",
      );
      expect(livenessAfter.length).toBe(countAtRelease);

      const { transcript } = readConversation(meta.id);
      expect(
        transcript.some(
          (e) =>
            e.type === "subagent_update" && e.step.kind === "liveness",
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("appends a delegations.jsonl record on delegation start", async () => {
    const {
      createConversation,
      readDelegations,
      createDelegateCustomTools: createTools,
    } = await load();
    const meta = await createConversation({
      title: "Persist ids",
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

    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "remember me" },
      { toolCallId: "call-persist-1" },
    );

    const expectedModel = formatEffectiveModel(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      agentId: result.agentId,
      role: "pinned-role",
      model: expectedModel,
    });
    expect(typeof records[0]!.delegationId).toBe("string");
    expect(records[0]!.delegationId.length).toBeGreaterThan(0);
    expect(records[0]).not.toHaveProperty("parentDelegationId");
    expect(Number.isNaN(Date.parse(records[0]!.at))).toBe(false);
  });

  it("resumes from a persisted agent id after discarding in-memory session state", async () => {
    const {
      createConversation,
      readDelegations,
      conversationsDir,
      createDelegateCustomTools: createTools,
    } = await load();
    const meta = await createConversation({
      title: "Rehydrate resume",
      projectId: "platform",
      model: "composer-2.5",
    });
    const convStoreDir = join(conversationsDir, meta.id, "agent-state");

    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const firstTools = createTools({
      sdk: fake,
      cwd,
      storeDir: convStoreDir,
      agentsDir,
      conversationId: meta.id,
    });
    const first = await firstTools.delegate!.execute(
      { role: "pinned-role", prompt: "first turn" },
      {},
    );
    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toHaveLength(0);

    const persisted = readDelegations(meta.id);
    expect(persisted).toHaveLength(1);
    const agentId = persisted[0]!.agentId;
    expect(agentId).toBe(first.agentId);

    // Discard the tools factory (the only in-memory holder) and rehydrate
    // via readDelegations + a fresh delegate bridge on the same store.
    const secondTools = createTools({
      sdk: fake,
      cwd,
      storeDir: convStoreDir,
      agentsDir,
      conversationId: meta.id,
    });
    const second = await secondTools.delegate!.execute(
      {
        role: "pinned-role",
        prompt: "after restart",
        resumeId: agentId,
      },
      {},
    );

    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toEqual([
      {
        agentId,
        storeDir: join(convStoreDir, "nested", agentId),
        options: {
          cwd,
          model: resolveModelSelection("cursor-grok-4.5-high-fast"),
          customTools: expect.any(Object),
        },
      },
    ]);
    expect(second.agentId).toBe(agentId);
    expect(fake.handles[1]!.sends[0]!.prompt).toBe("after restart");

    const after = readDelegations(meta.id);
    expect(after).toHaveLength(2);
    expect(after[1]!.agentId).toBe(agentId);
  });

  it("delegations returns this conversation's records most-recent-first and excludes others", async () => {
    const {
      createConversation,
      updateMeta,
      createDelegateCustomTools: createTools,
    } = await load();

    const metaA = await createConversation({
      title: "Lookup A",
      projectId: "platform",
      model: "composer-2.5",
    });
    const metaB = await createConversation({
      title: "Lookup B",
      projectId: "platform",
      model: "composer-2.5",
    });
    await updateMeta(metaA.id, { agentId: "root-agent-a" });
    await updateMeta(metaB.id, { agentId: "root-agent-b" });

    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const toolsA = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: metaA.id,
    });
    const toolsB = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: metaB.id,
    });

    const first = await toolsA.delegate!.execute(
      { role: "pinned-role", prompt: "first" },
      {},
    );
    const second = await toolsA.delegate!.execute(
      { role: "pinned-role", prompt: "second" },
      {},
    );
    await toolsB.delegate!.execute(
      { role: "pinned-role", prompt: "other conversation" },
      {},
    );

    const expectedModel = formatEffectiveModel(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    const listedA = await toolsA.delegations!.execute({}, {});
    expect(listedA.root).toEqual({ agentId: "root-agent-a" });
    const listed = listedA.delegations;
    expect(listed).toHaveLength(2);
    expect(listed[0]).toMatchObject({
      agentId: second.agentId,
      role: "pinned-role",
      model: expectedModel,
    });
    expect(listed[1]).toMatchObject({
      agentId: first.agentId,
      role: "pinned-role",
      model: expectedModel,
    });
    for (const row of listed) {
      expect(typeof row.delegationId).toBe("string");
      expect(row.delegationId.length).toBeGreaterThan(0);
      expect(typeof row.at).toBe("string");
      expect(Number.isNaN(Date.parse(row.at))).toBe(false);
      expect(row).not.toHaveProperty("parentDelegationId");
    }

    const listedB = await toolsB.delegations!.execute({}, {});
    expect(listedB.root).toEqual({ agentId: "root-agent-b" });
    expect(listedB.delegations).toHaveLength(1);
  });

  it("delegations reports the session root agent id with nested rows in order", async () => {
    const {
      createConversation,
      updateMeta,
      createDelegateCustomTools: createTools,
    } = await load();

    const meta = await createConversation({
      title: "Root lookup",
      projectId: "platform",
      model: "composer-2.5",
    });
    const rootAgentId = "session-root-xyz";
    await updateMeta(meta.id, { agentId: rootAgentId });

    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const tools = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    const first = await tools.delegate!.execute(
      { role: "pinned-role", prompt: "alpha" },
      {},
    );
    const second = await tools.delegate!.execute(
      { role: "pinned-role", prompt: "beta" },
      {},
    );

    const result = await tools.delegations!.execute({}, {});
    expect(result.root).toEqual({ agentId: rootAgentId });
    expect(result.delegations).toHaveLength(2);
    expect(result.delegations[0]).toMatchObject({
      agentId: second.agentId,
      role: "pinned-role",
    });
    expect(result.delegations[1]).toMatchObject({
      agentId: first.agentId,
      role: "pinned-role",
    });
    for (const row of result.delegations) {
      expect(typeof row.delegationId).toBe("string");
      expect(typeof row.model).toBe("string");
      expect(typeof row.at).toBe("string");
    }
  });

  it("delegations omits root and returns empty delegations when no session root is recorded", async () => {
    const { createConversation, createDelegateCustomTools: createTools } =
      await load();

    const meta = await createConversation({
      title: "No root yet",
      projectId: "platform",
      model: "composer-2.5",
    });

    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const tools = createTools({
      sdk: fake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    await tools.delegate!.execute(
      { role: "pinned-role", prompt: "nested only" },
      {},
    );

    const result = await tools.delegations!.execute({}, {});
    expect(result).toEqual({ delegations: [] });
    expect(result).not.toHaveProperty("root");
  });

  it("accepts an agentId from delegations as delegate resumeId", async () => {
    const {
      createConversation,
      conversationsDir,
      updateMeta,
      createDelegateCustomTools: createTools,
    } = await load();
    const meta = await createConversation({
      title: "Resume via lookup",
      projectId: "platform",
      model: "composer-2.5",
    });
    await updateMeta(meta.id, { agentId: "root-agent-resume" });
    const convStoreDir = join(conversationsDir, meta.id, "agent-state");

    const fake = createFakeAgentSdk({ stream: ASSISTANT_STREAM });
    const tools = createTools({
      sdk: fake,
      cwd,
      storeDir: convStoreDir,
      agentsDir,
      conversationId: meta.id,
    });

    await tools.delegate!.execute(
      { role: "pinned-role", prompt: "first turn" },
      {},
    );
    expect(fake.created).toHaveLength(1);

    const { delegations } = await tools.delegations!.execute({}, {});
    const [record] = delegations;
    expect(record).toBeDefined();

    const resumed = await tools.delegate!.execute(
      {
        role: "pinned-role",
        prompt: "after lookup",
        resumeId: record!.agentId,
      },
      {},
    );

    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toHaveLength(1);
    expect(fake.resumed[0]!.agentId).toBe(record!.agentId);
    expect(resumed.agentId).toBe(record!.agentId);
    expect(fake.handles[1]!.sends[0]!.prompt).toBe("after lookup");
  });
});

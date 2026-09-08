import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import type { ConversationFrame } from "./conversation-stream.js";
import { NESTED_RUN_HEARTBEAT_MS } from "./delegate-tool.js";
import {
  agentsDir,
  ASSISTANT_STREAM,
  cwd,
  loadNestedRunPublishModules,
  nestedRunIssuesRoot,
  NESTED_RUN_PUBLISH_AT,
  setupDelegateToolTest,
  setupNestedRunPublishTest,
  storeDir,
  teardownDelegateToolTest,
  teardownNestedRunPublishTest,
  waitForHandleSend,
} from "./delegate-tool.fixtures.js";
import {
  formatEffectiveModel,
  resolveModelSelection,
} from "./model-selection.js";

beforeEach(() => {
  setupDelegateToolTest();
});

afterEach(() => {
  teardownDelegateToolTest();
});

describe("delegate publishes nested run frames", () => {
  beforeEach(() => {
    setupNestedRunPublishTest();
  });

  afterEach(() => {
    teardownNestedRunPublishTest();
  });

  it("persists a terminal delegate tool_call when a caller error throws with pipeline context", async () => {
    const {
      createConversation,
      readConversation,
      createDelegateCustomTools: createTools,
    } = await loadNestedRunPublishModules();
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
    } = await loadNestedRunPublishModules();
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
    } = await loadNestedRunPublishModules();
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
    await waitForHandleSend(fake, 0);

    // Nest through the outer agent's bound delegate tools while the outer run
    // is still held mid-stream. Both sends share the fake's hold, so await
    // them only after release.
    const innerPromise = fake.created[0]!.customTools!.delegate!.execute(
      { role: "pinned-role", prompt: "inner" },
      { toolCallId: "call-inner" },
    );
    await waitForHandleSend(fake, 1);

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
      } = await loadNestedRunPublishModules();
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

  it("records issueId and parentCallId on a delegation when both are provided", async () => {
    const {
      createConversation,
      readDelegations,
      createDelegateCustomTools: createTools,
    } = await loadNestedRunPublishModules();
    mkdirSync(join(nestedRunIssuesRoot, "linked-task"), { recursive: true });
    writeFileSync(
      join(nestedRunIssuesRoot, "linked-task", "issue.json"),
      JSON.stringify({
        id: "linked-task",
        kind: "task",
        partOf: "platform",
        title: "Linked task",
        status: "todo",
        createdAt: NESTED_RUN_PUBLISH_AT,
        updatedAt: NESTED_RUN_PUBLISH_AT,
      }),
    );

    const meta = await createConversation({
      title: "Issue link",
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
      {
        role: "pinned-role",
        prompt: "for issue",
        issueId: "linked-task",
      },
      { toolCallId: "call-linked-task" },
    );

    const records = readDelegations(meta.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      agentId: result.agentId,
      role: "pinned-role",
      issueId: "linked-task",
      parentCallId: "call-linked-task",
    });
  });

  it("throws for an unknown issueId without writing a delegation record", async () => {
    const {
      createConversation,
      readDelegations,
      createDelegateCustomTools: createTools,
    } = await loadNestedRunPublishModules();
    const meta = await createConversation({
      title: "Unknown issue link",
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
          prompt: "bad link",
          issueId: "no-such-issue",
        },
        { toolCallId: "call-bad-issue" },
      ),
    ).rejects.toThrow('delegate: unknown issue "no-such-issue"');
    expect(readDelegations(meta.id)).toHaveLength(0);
    expect(fake.created).toHaveLength(0);
  });

  it("appends a delegations.jsonl record on delegation start", async () => {
    const {
      createConversation,
      readDelegations,
      createDelegateCustomTools: createTools,
    } = await loadNestedRunPublishModules();
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
    expect(records[0]!.lifecycle).toBe("tracked");
    expect(records[0]!.end).toMatchObject({ status: "completed" });
  });

  it("resumes from a persisted agent id after discarding in-memory session state", async () => {
    const {
      createConversation,
      readDelegations,
      conversationsDir,
      createDelegateCustomTools: createTools,
    } = await loadNestedRunPublishModules();
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
    expect(fake.handles[1]!.sends[0]!.message).toBe("after restart");

    const after = readDelegations(meta.id);
    expect(after).toHaveLength(2);
    expect(after[1]!.agentId).toBe(agentId);
  });

  it("delegations returns this conversation's records most-recent-first and excludes others", async () => {
    const {
      createConversation,
      updateMeta,
      createDelegateCustomTools: createTools,
    } = await loadNestedRunPublishModules();

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
    } = await loadNestedRunPublishModules();

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
      await loadNestedRunPublishModules();

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
    } = await loadNestedRunPublishModules();
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
    expect(fake.handles[1]!.sends[0]!.message).toBe("after lookup");
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

    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "success" },
      { toolCallId: "call-success-end" },
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
          isRetryable: true,
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

    const result = await customTools.delegate!.execute(
      { role: "pinned-role", prompt: "auth fail" },
      { toolCallId: "call-auth-end" },
    );
    expect(result.ok).toBe(false);

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

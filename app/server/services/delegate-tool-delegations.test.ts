import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import {
  delegateResultOf,
  delegationsListingOf,
} from "./delegate-tool.test-helpers.js";
import {
  agentsDir,
  ASSISTANT_STREAM,
  cwd,
  holdAfterStream,
  loadNestedRunPublishModules,
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

describe("delegate delegations listing and lifecycle", () => {
  beforeEach(() => {
    setupNestedRunPublishTest();
  });

  afterEach(() => {
    teardownNestedRunPublishTest();
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

    const first = delegateResultOf(
      await toolsA.delegate!.execute(
        { role: "pinned-role", prompt: "first" },
        {},
      ),
    );
    const second = delegateResultOf(
      await toolsA.delegate!.execute(
        { role: "pinned-role", prompt: "second" },
        {},
      ),
    );
    await toolsB.delegate!.execute(
      { role: "pinned-role", prompt: "other conversation" },
      {},
    );

    const expectedModel = formatEffectiveModel(
      resolveModelSelection("cursor-grok-4.5-high-fast"),
    );
    const listedA = delegationsListingOf(
      await toolsA.delegations!.execute({}, {}),
    );
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

    const listedB = delegationsListingOf(
      await toolsB.delegations!.execute({}, {}),
    );
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

    const first = delegateResultOf(
      await tools.delegate!.execute(
        { role: "pinned-role", prompt: "alpha" },
        {},
      ),
    );
    const second = delegateResultOf(
      await tools.delegate!.execute(
        { role: "pinned-role", prompt: "beta" },
        {},
      ),
    );

    const result = delegationsListingOf(
      await tools.delegations!.execute({}, {}),
    );
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
      expect(row.end).toMatchObject({ status: "completed" });
      expect(typeof row.end!.endedAt).toBe("string");
    }
  });

  it("delegations exposes parentDelegationId and end lifecycle on each row", async () => {
    const {
      createConversation,
      updateMeta,
      createDelegateCustomTools: createTools,
    } = await loadNestedRunPublishModules();

    const meta = await createConversation({
      title: "Delegations lifecycle",
      projectId: "platform",
      model: "composer-2.5",
    });
    await updateMeta(meta.id, { agentId: "root-agent" });

    const authFake = createFakeAgentSdk({
      stream: [],
      waitResult: {
        id: "run-auth",
        status: "error",
        error: {
          message:
            "Authentication error. If you are logged in, try logging out and back in.",
          code: "AUTH_TOKEN_EXPIRED",
          isRetryable: true,
        },
      },
    });
    const tools = createTools({
      sdk: authFake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });
    await tools.delegate!.execute(
      { role: "pinned-role", prompt: "fail" },
      { toolCallId: "call-fail" },
    );

    let listed = delegationsListingOf(await tools.delegations!.execute({}, {}));
    expect(listed.delegations).toHaveLength(1);
    const failed = listed.delegations[0]!;
    expect(failed).not.toHaveProperty("parentDelegationId");
    expect(failed.end).toMatchObject({
      status: "error",
      failureClass: "auth",
    });
    expect(typeof failed.end!.endedAt).toBe("string");

    const { hold, release } = holdAfterStream();
    const holdFake = createFakeAgentSdk({ hold, stream: [] });
    const holdTools = createTools({
      sdk: holdFake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });
    const running = holdTools.delegate!.execute(
      { role: "pinned-role", prompt: "running" },
      {},
    );
    await waitForHandleSend(holdFake, 0);

    listed = delegationsListingOf(await holdTools.delegations!.execute({}, {}));
    const inFlight = listed.delegations[0]!;
    expect(inFlight).not.toHaveProperty("end");

    release();
    await running;

    let releaseOuter!: () => void;
    const holdOuter = new Promise<void>((resolve) => {
      releaseOuter = resolve;
    });
    const nestFake = createFakeAgentSdk({
      hold: holdOuter,
      stream: ASSISTANT_STREAM,
    });
    const nestTools = createTools({
      sdk: nestFake,
      cwd,
      storeDir,
      agentsDir,
      conversationId: meta.id,
    });

    const outerPromise = nestTools.delegate!.execute(
      { role: "pinned-role", prompt: "outer" },
      { toolCallId: "call-outer-nest" },
    );
    await waitForHandleSend(nestFake, 0);

    const innerPromise = nestFake.created[0]!.customTools!.delegate!.execute(
      { role: "pinned-role", prompt: "inner" },
      { toolCallId: "call-inner-nest" },
    );
    await waitForHandleSend(nestFake, 1);

    listed = delegationsListingOf(await nestTools.delegations!.execute({}, {}));
    const innerInFlight = listed.delegations.find((row) => row.parentDelegationId);
    expect(innerInFlight).toBeDefined();
    expect(innerInFlight!.parentDelegationId).toEqual(expect.any(String));
    expect(innerInFlight).not.toHaveProperty("end");

    releaseOuter();
    await Promise.all([outerPromise, innerPromise]);

    listed = delegationsListingOf(await nestTools.delegations!.execute({}, {}));
    const nestedCompleted = listed.delegations.find((row) => row.parentDelegationId);
    expect(nestedCompleted!.end).toMatchObject({ status: "completed" });
    expect(typeof nestedCompleted!.end!.endedAt).toBe("string");
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

    const { delegations } = delegationsListingOf(
      await tools.delegations!.execute({}, {}),
    );
    const [record] = delegations;
    expect(record).toBeDefined();

    const resumed = delegateResultOf(
      await tools.delegate!.execute(
        {
          role: "pinned-role",
          prompt: "after lookup",
          resumeId: record!.agentId,
        },
        {},
      ),
    );

    expect(fake.created).toHaveLength(1);
    expect(fake.resumed).toHaveLength(1);
    expect(fake.resumed[0]!.agentId).toBe(record!.agentId);
    expect(resumed.agentId).toBe(record!.agentId);
    expect(fake.handles[1]!.sends[0]!.message).toBe("after lookup");
  });
});

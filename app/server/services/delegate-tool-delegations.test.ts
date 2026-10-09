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
  loadNestedRunPublishModules,
  setupDelegateToolTest,
  setupNestedRunPublishTest,
  storeDir,
  teardownDelegateToolTest,
  teardownNestedRunPublishTest,
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
});

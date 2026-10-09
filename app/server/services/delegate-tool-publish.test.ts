import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAgentSdk } from "./agent-sdk.fake.js";
import type { ConversationFrame } from "./conversation-stream.js";
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

describe("delegate publishes nested run frames", () => {
  beforeEach(() => {
    setupNestedRunPublishTest();
  });

  afterEach(() => {
    teardownNestedRunPublishTest();
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
});

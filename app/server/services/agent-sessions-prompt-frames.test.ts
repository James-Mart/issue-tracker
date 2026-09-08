import { describe, expect, it } from "vitest";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
} from "./agent-sdk.fake.js";
import {
  load,
  useAgentSessionsTestFixtures,
} from "./agent-sessions.test-harness.js";
import type { ConversationFrame } from "./conversation-stream.js";

useAgentSessionsTestFixtures();

describe("startConversationPrompt prompt live frames", () => {
  it("publishes the prompt frame on idle send", async () => {
    const {
      createConversation,
      readConversation,
      startConversationPrompt,
      createAgentSessions,
      subscribeFrames,
    } = await load();
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Idle send",
      projectId: "platform",
      model: "composer-2.5",
    });

    const promptFrames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      if (frame.event.type === "prompt") promptFrames.push(frame);
    });

    const result = await startConversationPrompt(
      meta.id,
      "go now",
      undefined,
      sessions,
    );
    unsubscribe();

    expect(result.ok).toBe(true);
    const { transcript } = readConversation(meta.id);
    const persisted = transcript.find((e) => e.type === "prompt");
    expect(persisted).toMatchObject({ type: "prompt", text: "go now" });
    expect(promptFrames).toHaveLength(1);
    expect(promptFrames[0]).toMatchObject({
      persist: false,
      event: {
        type: "prompt",
        text: "go now",
        seq: persisted?.seq,
        at: persisted?.at,
      },
    });
  });
});

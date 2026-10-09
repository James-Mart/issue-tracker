import { describe, expect, it } from "vitest";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
} from "./agent-sdk.fake.js";
import {
  AT,
  load,
  useAgentSessionsTestFixtures,
} from "./agent-sessions.test-harness.js";
import type { ConversationFrame } from "./conversation-stream.js";

useAgentSessionsTestFixtures();

describe("pending message firing", () => {
  it("fires a pending message as a new run after a clean finish", async () => {
    const {
      createConversation,
      readConversation,
      updateMeta,
      createAgentSessions,
      subscribeFrames,
    } = await load();
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Fire pending",
      projectId: "platform",
      model: "composer-2.5",
    });
    await updateMeta(meta.id, {
      pendingMessage: { text: "follow up", at: AT },
    });

    const promptFrames: ConversationFrame[] = [];
    const unsubscribe = subscribeFrames(meta.id, (frame) => {
      if (frame.event.type === "prompt") promptFrames.push(frame);
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "first turn" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();
    unsubscribe();

    // Give the fired run time to settle.
    for (let i = 0; i < 50; i += 1) {
      const { transcript } = readConversation(meta.id);
      if (transcript.some((e) => e.type === "assistant")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const { meta: nextMeta, transcript } = readConversation(meta.id);
    expect(nextMeta.pendingMessage).toBeUndefined();
    expect(
      transcript.filter((e) => e.type === "prompt").map((e) => e.text),
    ).toEqual(["follow up"]);
    const flushedPrompt = transcript.find((e) => e.type === "prompt");
    expect(promptFrames).toHaveLength(1);
    expect(promptFrames[0]).toMatchObject({
      persist: false,
      event: {
        type: "prompt",
        text: "follow up",
        seq: flushedPrompt?.seq,
        at: flushedPrompt?.at,
      },
    });
    expect(fake.handles[0]?.sends).toEqual([
      { message: "first turn", options: {} },
      { message: "follow up", options: {} },
    ]);
  });
});

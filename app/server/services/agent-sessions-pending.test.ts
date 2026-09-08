import { join } from "path";
import { describe, expect, it } from "vitest";
import { CursorAgentError } from "./agent-sdk.js";
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

  it("fires a pending message with attachments on the prompt event", async () => {
    const { conversationsDir } = await import("../config.js");
    const {
      createConversation,
      readConversation,
      updateMeta,
      createAgentSessions,
    } = await load();
    const { putConversationAttachment } = await import(
      "./conversation-attachments.js"
    );
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Fire pending attachments",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(
      meta.id,
      "mock.tsx",
      Buffer.from("export const x = 1;\n"),
    );
    await updateMeta(meta.id, {
      pendingMessage: {
        text: "see file",
        at: AT,
        attachments: ["mock.tsx"],
      },
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "first turn" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    for (let i = 0; i < 50; i += 1) {
      const { transcript } = readConversation(meta.id);
      if (transcript.some((e) => e.type === "assistant")) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "mock.tsx",
    );
    const { transcript } = readConversation(meta.id);
    expect(
      transcript.filter((e) => e.type === "prompt").map((e) => ({
        text: e.text,
        attachments: e.type === "prompt" ? e.attachments : undefined,
      })),
    ).toEqual([{ text: "see file", attachments: ["mock.tsx"] }]);
    expect(fake.handles[0]?.sends).toEqual([
      { message: "first turn", options: {} },
      {
        message: `see file\n\nAttachments:\n- mock.tsx — ${absolutePath}`,
        options: {},
      },
    ]);
  });

  it("restores pending and surfaces an error when firing fails to start a run", async () => {
    const {
      createConversation,
      readConversation,
      updateMeta,
      createAgentSessions,
    } = await load();
    const fake = createFakeAgentSdk({
      sendScript: [
        { stream: buildScriptedStreamWithAgentIdHint() },
        { sendError: new CursorAgentError("Invalid API key") },
      ],
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Fire pending failure",
      projectId: "platform",
      model: "composer-2.5",
    });
    await updateMeta(meta.id, {
      pendingMessage: { text: "follow up", at: AT },
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "first turn" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    const { meta: nextMeta, transcript } = readConversation(meta.id);
    expect(nextMeta.pendingMessage?.text).toBe("follow up");
    expect(
      transcript.filter((e) => e.type === "prompt").map((e) => e.text),
    ).toEqual(["follow up"]);
    expect(transcript.at(-1)).toMatchObject({
      type: "error",
      message: "Invalid API key",
    });
    expect(fake.handles[0]?.sends).toEqual([
      { message: "first turn", options: {} },
      { message: "follow up", options: {} },
    ]);
  });

  it("leaves a pending message in place after an errored run", async () => {
    const {
      createConversation,
      readConversation,
      updateMeta,
      createAgentSessions,
    } = await load();
    const fake = createFakeAgentSdk({
      waitResult: {
        id: "run-err",
        status: "error",
        error: { message: "model failed", code: "MODEL" },
      },
    });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Error keeps pending",
      projectId: "platform",
      model: "auto",
    });
    await updateMeta(meta.id, {
      pendingMessage: { text: "still waiting", at: AT },
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "fail me" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await result.run.wait();

    const { meta: nextMeta, transcript } = readConversation(meta.id);
    expect(nextMeta.pendingMessage?.text).toBe("still waiting");
    expect(transcript.some((e) => e.type === "prompt")).toBe(false);
    expect(fake.handles[0]?.sends).toEqual([{ message: "fail me", options: {} }]);
  });

  it("leaves a pending message in place after a cancelled run", async () => {
    const {
      createConversation,
      readConversation,
      updateMeta,
      createAgentSessions,
    } = await load();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({ hold });
    const sessions = createAgentSessions(fake);

    const meta = await createConversation({
      title: "Cancel keeps pending",
      projectId: "platform",
      model: "auto",
    });
    await updateMeta(meta.id, {
      pendingMessage: { text: "still waiting", at: AT },
    });

    const result = await sessions.sendPrompt(meta.id, { prompt: "cancel me" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await Promise.resolve();
    expect(await sessions.cancel(meta.id)).toBe(true);
    await result.run.wait();
    release();

    const { meta: nextMeta } = readConversation(meta.id);
    expect(nextMeta.pendingMessage?.text).toBe("still waiting");
  });
});

import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  loadConfig,
  loadService,
  stubSessions,
  useConversationFixtures,
} from "./conversations.test-fixtures.js";

useConversationFixtures();

describe("prompt assembly", () => {
  async function loadAttachments() {
    return import("./conversation-attachments.js");
  }

  it("sends text unchanged with no images when there are no attachments", async () => {
    const { createConversation, startConversationPrompt } = await loadService();
    const sessions = stubSessions();

    const meta = await createConversation({
      title: "Plain send",
      projectId: "platform",
      model: "composer-2.5",
    });

    await startConversationPrompt(
      meta.id,
      "hello agent",
      undefined,
      sessions,
    );

    expect(sessions.sendPrompt).toHaveBeenCalledWith(meta.id, {
      prompt: "hello agent",
      model: undefined,
    });
  });

  it("appends an attachment block after the human text", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, startConversationPrompt, assembleAgentPrompt } =
      await loadService();
    const { putConversationAttachment } = await loadAttachments();
    const sessions = stubSessions();

    const meta = await createConversation({
      title: "Attach block",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(
      meta.id,
      "notes.txt",
      Buffer.from("context\n"),
    );
    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "notes.txt",
    );

    await startConversationPrompt(
      meta.id,
      "review this",
      undefined,
      sessions,
      { attachments: ["notes.txt"] },
    );

    expect(sessions.sendPrompt).toHaveBeenCalledWith(meta.id, {
      prompt: `review this\n\nAttachments:\n- notes.txt — ${absolutePath}`,
      model: undefined,
    });

    const { readConversation } = await loadService();
    const { transcript } = readConversation(meta.id);
    expect(transcript[0]).toMatchObject({
      type: "prompt",
      text: "review this",
      attachments: ["notes.txt"],
    });

    const assembled = await assembleAgentPrompt(meta.id, "review this", [
      "notes.txt",
    ]);
    expect(assembled).toEqual({
      prompt: `review this\n\nAttachments:\n- notes.txt — ${absolutePath}`,
    });
    expect(assembled.images).toBeUndefined();
  });

  it("uses the attachment block alone when human text is empty", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, assembleAgentPrompt } = await loadService();
    const { putConversationAttachment } = await loadAttachments();

    const meta = await createConversation({
      title: "Attach only",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(
      meta.id,
      "notes.txt",
      Buffer.from("context\n"),
    );
    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "notes.txt",
    );

    const assembled = await assembleAgentPrompt(meta.id, "", ["notes.txt"]);
    expect(assembled).toEqual({
      prompt: `Attachments:\n- notes.txt — ${absolutePath}`,
    });
    expect(assembled.images).toBeUndefined();
  });

  it("includes one image payload for an image attachment", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, assembleAgentPrompt } = await loadService();
    const { putConversationAttachment } = await loadAttachments();
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const meta = await createConversation({
      title: "Image attach",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(meta.id, "diagram.png", pngBytes);
    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "diagram.png",
    );

    const assembled = await assembleAgentPrompt(meta.id, "what is this?", [
      "diagram.png",
    ]);
    expect(assembled.prompt).toBe(
      `what is this?\n\nAttachments:\n- diagram.png — ${absolutePath}`,
    );
    expect(assembled.images).toEqual([
      {
        data: pngBytes.toString("base64"),
        mimeType: "image/png",
      },
    ]);
  });

  it("does not add images for a non-image attachment", async () => {
    const { conversationsDir } = await loadConfig();
    const { createConversation, assembleAgentPrompt } = await loadService();
    const { putConversationAttachment } = await loadAttachments();

    const meta = await createConversation({
      title: "File attach",
      projectId: "platform",
      model: "composer-2.5",
    });
    await putConversationAttachment(
      meta.id,
      "mock.tsx",
      Buffer.from("export const x = 1;\n"),
    );
    const absolutePath = join(
      conversationsDir,
      meta.id,
      "attachments",
      "mock.tsx",
    );

    const assembled = await assembleAgentPrompt(meta.id, "review", [
      "mock.tsx",
    ]);
    expect(assembled).toEqual({
      prompt: `review\n\nAttachments:\n- mock.tsx — ${absolutePath}`,
    });
    expect(assembled.images).toBeUndefined();
  });
});

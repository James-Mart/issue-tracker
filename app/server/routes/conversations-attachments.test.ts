import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "../services/attachments.js";
import {
  baseUrl,
  startHeldConversationRouter,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures();

async function createConversation(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "platform", title: "Attachments chat" }),
  });
  expect(res.status).toBe(201);
  const meta = (await res.json()) as { id: string };
  return meta.id;
}

async function upload(
  conversationId: string,
  filename: string,
  body: Uint8Array | string,
): Promise<Response> {
  const form = new FormData();
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  form.append("attachment", new Blob([bytes]), filename);
  return fetch(`${baseUrl}/api/conversations/${conversationId}/attachments`, {
    method: "POST",
    body: form,
  });
}

async function uploadConversationAttachment(
  apiBaseUrl: string,
  conversationId: string,
  filename: string,
  body: string,
): Promise<void> {
  const form = new FormData();
  form.append(
    "attachment",
    new Blob([new TextEncoder().encode(body)]),
    filename,
  );
  const res = await fetch(
    `${apiBaseUrl}/api/conversations/${conversationId}/attachments`,
    { method: "POST", body: form },
  );
  expect(res.status).toBe(201);
}

describe("conversation attachments HTTP API", () => {
  it("upload then fetch returns the same bytes and content type", async () => {
    const conversationId = await createConversation();
    const payload = "export const x = 1;\n";
    const created = await upload(conversationId, "mock.tsx", payload);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      name: "mock.tsx",
      size: payload.length,
      mimeType: "application/octet-stream",
    });

    const downloaded = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments/mock.tsx`,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toMatch(
      /application\/octet-stream/,
    );
    expect(await downloaded.text()).toBe(payload);
  });

  it("list and upload responses carry mimeType", async () => {
    const conversationId = await createConversation();
    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const created = await upload(conversationId, "shot.png", pngBytes);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      name: "shot.png",
      size: pngBytes.length,
      mimeType: "image/png",
    });

    const listed = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments`,
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      attachments: [
        { name: "shot.png", size: pngBytes.length, mimeType: "image/png" },
      ],
    });
  });

  it("delete removes an attachment", async () => {
    const conversationId = await createConversation();
    const created = await upload(conversationId, "note.txt", "hello");
    expect(created.status).toBe(201);

    const deleted = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments/note.txt`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(204);

    const listed = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments`,
    );
    expect(await listed.json()).toEqual({ attachments: [] });

    const missing = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/attachments/note.txt`,
    );
    expect(missing.status).toBe(404);
  });

  it("rejects oversize uploads with 413", async () => {
    const conversationId = await createConversation();
    const oversize = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    const res = await upload(conversationId, "big.bin", oversize);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      error: `attachment exceeds ${MAX_ATTACHMENT_BYTES} byte limit`,
      code: "attachment-too-large",
    });
  });

  it("returns 404 for an unknown conversation", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/ghost/attachments`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'unknown conversation "ghost"',
      code: "not_found",
    });
  });
});

describe("POST /api/conversations/:id/messages with attachments", () => {
  it("persists attachments on the prompt event", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Attach send" }),
    }).then((r) => r.json());

    await uploadConversationAttachment(baseUrl, created.id, "mock.tsx", "export const x = 1;\n");

    const send = await fetch(
      `${baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "review this",
          attachments: ["mock.tsx"],
        }),
      },
    );
    expect(send.status).toBe(202);

    const detail = await fetch(`${baseUrl}/api/conversations/${created.id}`).then(
      (r) => r.json(),
    );
    const prompt = detail.transcript.find(
      (e: { type: string }) => e.type === "prompt",
    );
    expect(prompt).toMatchObject({
      type: "prompt",
      text: "review this",
      attachments: ["mock.tsx"],
    });
  });

  it("returns 400 for unknown attachment names", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Missing attach" }),
    }).then((r) => r.json());

    const send = await fetch(
      `${baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "hello",
          attachments: ["ghost.png"],
        }),
      },
    );
    expect(send.status).toBe(400);
    expect(await send.json()).toEqual({
      error: "attachment not found: ghost.png",
    });
  });

  it("accepts an attachments-only send", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Attach only" }),
    }).then((r) => r.json());

    await uploadConversationAttachment(baseUrl, created.id, "notes.txt", "context\n");

    const send = await fetch(
      `${baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "", attachments: ["notes.txt"] }),
      },
    );
    expect(send.status).toBe(202);

    const detail = await fetch(`${baseUrl}/api/conversations/${created.id}`).then(
      (r) => r.json(),
    );
    const prompt = detail.transcript.find(
      (e: { type: string }) => e.type === "prompt",
    );
    expect(prompt).toMatchObject({
      type: "prompt",
      text: "",
      attachments: ["notes.txt"],
    });
  });

  it("rejects a send with neither prompt nor attachments", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Empty send" }),
    }).then((r) => r.json());

    const send = await fetch(
      `${baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "   ", attachments: [] }),
      },
    );
    expect(send.status).toBe(400);
    expect(await send.json()).toEqual({ error: "prompt is required" });
  });

  it("queues attachments on a pending message and delivers them when the run drains", async () => {
    const held = await startHeldConversationRouter();
    try {
      const created = await fetch(`${held.baseUrl}/api/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "platform", title: "Pending attach" }),
      }).then((r) => r.json());

      await uploadConversationAttachment(
        held.baseUrl,
        created.id,
        "mock.tsx",
        "export const x = 1;\n",
      );

      const first = await fetch(
        `${held.baseUrl}/api/conversations/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "hold please" }),
        },
      );
      expect(first.status).toBe(202);
      await Promise.resolve();

      const queued = await fetch(
        `${held.baseUrl}/api/conversations/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: "review",
            attachments: ["mock.tsx"],
          }),
        },
      );
      expect(queued.status).toBe(202);
      expect(await queued.json()).toEqual({ pending: true });

      let detail: {
        meta: { pendingMessage?: { attachments?: string[] } };
        transcript: { type: string; attachments?: string[]; text?: string }[];
      };
      detail = await fetch(`${held.baseUrl}/api/conversations/${created.id}`).then(
        (r) => r.json(),
      );
      expect(detail.meta.pendingMessage?.attachments).toEqual(["mock.tsx"]);

      held.releaseHold();

      for (let i = 0; i < 50; i += 1) {
        detail = await fetch(`${held.baseUrl}/api/conversations/${created.id}`).then(
          (r) => r.json(),
        );
        const prompts = detail.transcript.filter((e) => e.type === "prompt");
        if (
          detail.meta.pendingMessage === undefined &&
          prompts.some((e) => e.attachments?.includes("mock.tsx"))
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(detail!.meta.pendingMessage).toBeUndefined();
      expect(
        detail!.transcript.filter((e) => e.type === "prompt").map((e) => ({
          text: e.text,
          attachments: e.attachments,
        })),
      ).toEqual([
        { text: "hold please", attachments: undefined },
        { text: "review", attachments: ["mock.tsx"] },
      ]);
    } finally {
      await held.sessions.disposeAll();
      await new Promise<void>((resolve, reject) => {
        held.server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

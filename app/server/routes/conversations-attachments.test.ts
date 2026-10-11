import { describe, expect, it } from "vitest";
import {
  startHeldConversationRouter,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures({ listen: false });

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

describe("POST /api/conversations/:id/messages with attachments", () => {
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

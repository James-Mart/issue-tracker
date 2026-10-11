import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type HeldConversationRouter,
  startHeldConversationRouter,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures({ listen: false });

describe("POST /api/conversations/:id/messages mid-run steer", () => {
  let held: HeldConversationRouter;

  beforeEach(async () => {
    held = await startHeldConversationRouter({
      steerResult: "revert_to_followup",
      steerEmitsUserMessage: false,
    });
  });

  afterEach(async () => {
    held.releaseHold();
    await held.sessions.disposeAll();
    await new Promise<void>((resolve, reject) => {
      held.server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("falls back to pending when steer returns revert_to_followup", async () => {
    const created = await fetch(`${held.baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Steer fallback" }),
    }).then((r) => r.json());

    await fetch(`${held.baseUrl}/api/conversations/${created.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hold please" }),
    });
    await Promise.resolve();

    const fallback = await fetch(
      `${held.baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "queue instead" }),
      },
    );
    expect(fallback.status).toBe(202);
    expect(await fallback.json()).toEqual({ pending: true });

    const detail = await fetch(
      `${held.baseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(detail.meta.pendingMessage?.text).toBe("queue instead");
    expect(
      detail.transcript.filter((e: { type: string }) => e.type === "prompt"),
    ).toEqual([
      expect.objectContaining({ type: "prompt", text: "hold please" }),
    ]);
  });
});

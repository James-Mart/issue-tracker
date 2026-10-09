import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeAgentSdk } from "../services/agent-sdk.fake.js";
import { CursorAgentError } from "../services/agent-sdk.js";
import {
  type ConversationRouter,
  startConversationRouter,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures({ listen: false });

describe("POST /api/conversations/:id/messages when the agent never starts", () => {
  let router: ConversationRouter;

  beforeEach(async () => {
    router = await startConversationRouter(
      createFakeAgentSdk({ sendError: new CursorAgentError("Invalid API key") }),
    );
  });

  afterEach(async () => {
    await router.sessions.disposeAll();
    await new Promise<void>((resolve, reject) => {
      router.server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns 502 and appends an error event to the transcript", async () => {
    const created = await fetch(`${router.baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Send failure" }),
    }).then((r) => r.json());

    const send = await fetch(`${router.baseUrl}/api/conversations/${created.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "this will fail" }),
    });
    expect(send.status).toBe(502);
    expect(await send.json()).toEqual({ error: "Invalid API key" });

    const detail = await fetch(`${router.baseUrl}/api/conversations/${created.id}`).then(
      (r) => r.json(),
    );
    expect(detail.transcript.map((e: { type: string }) => e.type)).toEqual([
      "prompt",
      "error",
    ]);
    const errorEvent = detail.transcript.find(
      (e: { type: string }) => e.type === "error",
    );
    expect(errorEvent).toMatchObject({
      type: "error",
      message: "Invalid API key",
    });
    expect(typeof errorEvent.at).toBe("string");
  });
});

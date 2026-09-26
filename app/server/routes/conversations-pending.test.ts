import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_RUN_ID } from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import {
  AT,
  startHeldConversationRouter,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures();

describe("pending message routes", () => {
  let pendingServer: Server;
  let pendingBaseUrl: string;
  let pendingSessions: AgentSessions;
  let releaseHold: () => void;

  beforeEach(async () => {
    const held = await startHeldConversationRouter();
    pendingServer = held.server;
    pendingBaseUrl = held.baseUrl;
    pendingSessions = held.sessions;
    releaseHold = held.releaseHold;
  });

  afterEach(async () => {
    releaseHold();
    await pendingSessions.disposeAll();
    await new Promise<void>((resolve, reject) => {
      pendingServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("stores a pending message during an active run when steer reverts", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { createFakeAgentSdk } = await import("../services/agent-sdk.fake.js");
    const fake = createFakeAgentSdk({
      stream: (await import("../services/agent-sdk.fake.js")).buildScriptedStreamWithAgentIdHint(),
      hold,
      steerResult: "revert_to_followup",
      steerEmitsUserMessage: false,
    });
    const { createAgentSessions } = await import("../services/agent-sessions.js");
    const { createConversationsRouter } = await import("./conversations.js");
    const { errorHandler } = await import("../errors.js");
    const sessions = createAgentSessions(fake);
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    app.use("/api/conversations", createConversationsRouter(sessions));
    app.use(errorHandler);

    let server: import("http").Server;
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server!.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP listen address");
    }
    const url = `http://127.0.0.1:${addr.port}`;

    try {
      const created = await fetch(`${url}/api/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "platform", title: "Pending send" }),
      }).then((r) => r.json());

      const first = await fetch(`${url}/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hold please" }),
      });
      expect(first.status).toBe(202);
      await Promise.resolve();

      const pending = await fetch(`${url}/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "  queued turn  " }),
      });
      expect(pending.status).toBe(202);
      expect(await pending.json()).toEqual({ pending: true });

      const detail = await fetch(`${url}/api/conversations/${created.id}`).then(
        (r) => r.json(),
      );
      expect(detail.meta.pendingMessage?.text).toBe("queued turn");
      expect(
        detail.transcript.filter((e: { type: string }) => e.type === "prompt"),
      ).toEqual([expect.objectContaining({ type: "prompt", text: "hold please" })]);
    } finally {
      release();
      await sessions.disposeAll();
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("clears a stored pending message on an immediate send and does not fire it later", async () => {
    const created = await fetch(`${pendingBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Clear pending" }),
    }).then((r) => r.json());

    const { updateMeta } = await import("../services/conversations.js");
    await updateMeta(created.id, {
      pendingMessage: { text: "stale pending", at: AT },
    });

    const send = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "send now" }),
      },
    );
    expect(send.status).toBe(202);
    expect(await send.json()).toEqual({ runId: FAKE_RUN_ID });

    let detail = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(detail.meta.pendingMessage).toBeUndefined();
    expect(
      detail.transcript.filter((e: { type: string }) => e.type === "prompt"),
    ).toEqual([expect.objectContaining({ type: "prompt", text: "send now" })]);

    releaseHold();
    for (let i = 0; i < 50; i += 1) {
      detail = await fetch(
        `${pendingBaseUrl}/api/conversations/${created.id}`,
      ).then((r) => r.json());
      if (detail.transcript.some((e: { type: string }) => e.type === "assistant")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(
      detail.transcript.filter((e: { type: string }) => e.type === "prompt"),
    ).toEqual([expect.objectContaining({ type: "prompt", text: "send now" })]);
  });

  it("fires a pending message when the held run finishes cleanly", async () => {
    const created = await fetch(`${pendingBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Fire on finish" }),
    }).then((r) => r.json());

    const first = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hold please" }),
      },
    );
    expect(first.status).toBe(202);
    await Promise.resolve();

    const { putConversationAttachment } = await import(
      "../services/conversation-attachments.js"
    );
    await putConversationAttachment(
      created.id,
      "note.txt",
      Buffer.from("attachment body"),
    );

    const queued = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "fire me later",
          attachments: ["note.txt"],
        }),
      },
    );
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({ pending: true });

    releaseHold();

    let detail: {
      meta: { pendingMessage?: { text: string } };
      transcript: { type: string; text?: string }[];
    };
    for (let i = 0; i < 50; i += 1) {
      detail = await fetch(
        `${pendingBaseUrl}/api/conversations/${created.id}`,
      ).then((r) => r.json());
      const prompts = detail.transcript.filter((e) => e.type === "prompt");
      if (
        detail.meta.pendingMessage === undefined &&
        prompts.some((e) => e.text === "fire me later")
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(detail!.meta.pendingMessage).toBeUndefined();
    expect(
      detail!.transcript.filter((e) => e.type === "prompt").map((e) => e.text),
    ).toEqual(["hold please", "fire me later"]);
  });

  it("PATCH replaces pending text and DELETE clears it", async () => {
    const created = await fetch(`${pendingBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Pending CRUD" }),
    }).then((r) => r.json());

    const badPatch = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}/pending`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      },
    );
    expect(badPatch.status).toBe(400);

    const patched = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}/pending`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "edited pending" }),
      },
    );
    expect(patched.status).toBe(200);
    const meta = await patched.json();
    expect(meta.pendingMessage?.text).toBe("edited pending");

    const cleared = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}/pending`,
      { method: "DELETE" },
    );
    expect(cleared.status).toBe(204);

    const detail = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(detail.meta.pendingMessage).toBeUndefined();
  });
});

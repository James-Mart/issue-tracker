import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
  type FakeAgentSdk,
} from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import { useConversationsTestFixtures } from "./conversations.test-harness.js";

useConversationsTestFixtures();

describe("POST /api/conversations/:id/messages mid-run steer", () => {
  let steerServer: Server;
  let steerBaseUrl: string;
  let steerSessions: AgentSessions;
  let steerFake: FakeAgentSdk;
  let releaseHold: () => void;

  beforeEach(async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    steerFake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
      hold,
      steerResult: "complete_delivered",
    });
    const { createAgentSessions } = await import("../services/agent-sessions.js");
    const { createConversationsRouter } = await import("./conversations.js");
    const { errorHandler } = await import("../errors.js");
    steerSessions = createAgentSessions(steerFake);
    const app = express();
    app.use(express.json());
    app.use("/api/conversations", createConversationsRouter(steerSessions));
    app.use(errorHandler);

    await new Promise<void>((resolve) => {
      steerServer = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = steerServer.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP listen address");
    }
    steerBaseUrl = `http://127.0.0.1:${addr.port}`;
    releaseHold = release;
  });

  afterEach(async () => {
    releaseHold();
    await steerSessions.disposeAll();
    await new Promise<void>((resolve, reject) => {
      steerServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns steered: true, persists the stream user message, and leaves no pending", async () => {
    const created = await fetch(`${steerBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Steer mid-run" }),
    }).then((r) => r.json());

    const first = await fetch(
      `${steerBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hold please" }),
      },
    );
    expect(first.status).toBe(202);
    await Promise.resolve();

    const steered = await fetch(
      `${steerBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "  steer this  " }),
      },
    );
    expect(steered.status).toBe(202);
    expect(await steered.json()).toEqual({ steered: true });

    const detail = await fetch(
      `${steerBaseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(detail.meta.pendingMessage).toBeUndefined();
    expect(steerFake.handles.flatMap((h) => h.steers)).toEqual(["steer this"]);
    expect(
      detail.transcript.filter((e: { type: string }) => e.type === "prompt"),
    ).toEqual([
      expect.objectContaining({ type: "prompt", text: "hold please" }),
      expect.objectContaining({ type: "prompt", text: "steer this" }),
    ]);
  });

  it("queues attachments without calling steer", async () => {
    const { putConversationAttachment } = await import(
      "../services/conversation-attachments.js"
    );

    const created = await fetch(`${steerBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Steer skip attach" }),
    }).then((r) => r.json());

    await fetch(`${steerBaseUrl}/api/conversations/${created.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hold please" }),
    });
    await Promise.resolve();

    await putConversationAttachment(
      created.id,
      "diagram.png",
      Buffer.from("png-bytes"),
    );

    const queued = await fetch(
      `${steerBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "see attached",
          attachments: ["diagram.png"],
        }),
      },
    );
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({ pending: true });

    expect(steerFake.handles.flatMap((h) => h.steers)).toEqual([]);

    const detail = await fetch(
      `${steerBaseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(detail.meta.pendingMessage?.text).toBe("see attached");
    expect(detail.meta.pendingMessage?.attachments).toEqual(["diagram.png"]);
  });

  it("falls back to pending when steer returns revert_to_followup", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
      hold,
      steerResult: "revert_to_followup",
      steerEmitsUserMessage: false,
    });
    const { createAgentSessions } = await import("../services/agent-sessions.js");
    const { createConversationsRouter } = await import("./conversations.js");
    const { errorHandler } = await import("../errors.js");
    const sessions = createAgentSessions(fake);
    const app = express();
    app.use(express.json());
    app.use("/api/conversations", createConversationsRouter(sessions));
    app.use(errorHandler);

    let server: Server;
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
        body: JSON.stringify({ projectId: "platform", title: "Steer fallback" }),
      }).then((r) => r.json());

      await fetch(`${url}/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hold please" }),
      });
      await Promise.resolve();

      const fallback = await fetch(
        `${url}/api/conversations/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "queue instead" }),
        },
      );
      expect(fallback.status).toBe(202);
      expect(await fallback.json()).toEqual({ pending: true });

      const detail = await fetch(`${url}/api/conversations/${created.id}`).then(
        (r) => r.json(),
      );
      expect(detail.meta.pendingMessage?.text).toBe("queue instead");
      expect(
        detail.transcript.filter((e: { type: string }) => e.type === "prompt"),
      ).toEqual([
        expect.objectContaining({ type: "prompt", text: "hold please" }),
      ]);
    } finally {
      release();
      await sessions.disposeAll();
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

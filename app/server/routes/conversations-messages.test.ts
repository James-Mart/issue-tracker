import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
  FAKE_RUN_ID,
} from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import { CursorAgentError } from "../services/agent-sdk.js";
import { useConversationsTestFixtures } from "./conversations.test-harness.js";

useConversationsTestFixtures();

describe("POST /api/conversations/:id/messages", () => {
  describe("successful send", () => {
    let msgServer: Server;
    let msgBaseUrl: string;
    let msgSessions: AgentSessions;

    beforeEach(async () => {
      const fake = createFakeAgentSdk({
        stream: buildScriptedStreamWithAgentIdHint(),
      });
      const { createAgentSessions } = await import("../services/agent-sessions.js");
      const { createConversationsRouter } = await import("./conversations.js");
      const { errorHandler } = await import("../errors.js");
      msgSessions = createAgentSessions(fake);
      const app = express();
      app.use(express.json());
      app.use("/api/conversations", createConversationsRouter(msgSessions));
      app.use(errorHandler);

      await new Promise<void>((resolve) => {
        msgServer = app.listen(0, "127.0.0.1", () => resolve());
      });
      const addr = msgServer.address();
      if (!addr || typeof addr === "string") {
        throw new Error("expected TCP listen address");
      }
      msgBaseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
      await msgSessions.disposeAll();
      await new Promise<void>((resolve, reject) => {
        msgServer.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it("returns 202 with runId and persists prompt + assistant after finalize", async () => {
      const created = await fetch(`${msgBaseUrl}/api/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "platform", title: "Prompt run" }),
      }).then((r) => r.json());

      const send = await fetch(`${msgBaseUrl}/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello agent" }),
      });
      expect(send.status).toBe(202);
      expect(await send.json()).toEqual({ runId: FAKE_RUN_ID });

      // Poll until the assistant response is persisted.
      let detail: { transcript: { type: string; text?: string }[] };
      for (let i = 0; i < 50; i += 1) {
        detail = await fetch(`${msgBaseUrl}/api/conversations/${created.id}`).then(
          (r) => r.json(),
        );
        const assistant = detail.transcript.find((e) => e.type === "assistant");
        if (assistant) break;
        await new Promise((r) => setTimeout(r, 20));
      }

      const prompt = detail!.transcript.find((e) => e.type === "prompt");
      const assistant = detail!.transcript.find((e) => e.type === "assistant");
      expect(prompt?.text).toBe("hello agent");
      expect(assistant?.text).toBeTruthy();
    });
  });

  describe("when the agent never starts", () => {
    let msgServer: Server;
    let msgBaseUrl: string;
    let msgSessions: AgentSessions;

    beforeEach(async () => {
      const fake = createFakeAgentSdk({
        sendError: new CursorAgentError("Invalid API key"),
      });
      const { createAgentSessions } = await import("../services/agent-sessions.js");
      const { createConversationsRouter } = await import("./conversations.js");
      const { errorHandler } = await import("../errors.js");
      msgSessions = createAgentSessions(fake);
      const app = express();
      app.use(express.json());
      app.use("/api/conversations", createConversationsRouter(msgSessions));
      app.use(errorHandler);

      await new Promise<void>((resolve) => {
        msgServer = app.listen(0, "127.0.0.1", () => resolve());
      });
      const addr = msgServer.address();
      if (!addr || typeof addr === "string") {
        throw new Error("expected TCP listen address");
      }
      msgBaseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
      await msgSessions.disposeAll();
      await new Promise<void>((resolve, reject) => {
        msgServer.close((err) => (err ? reject(err) : resolve()));
      });
    });

    it("returns 502 and appends an error event to the transcript", async () => {
      const created = await fetch(`${msgBaseUrl}/api/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "platform", title: "Send failure" }),
      }).then((r) => r.json());

      const send = await fetch(`${msgBaseUrl}/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "this will fail" }),
      });
      expect(send.status).toBe(502);
      expect(await send.json()).toEqual({ error: "Invalid API key" });

      const detail = await fetch(`${msgBaseUrl}/api/conversations/${created.id}`).then(
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
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import {
  buildScriptedStreamWithAgentIdHint,
  createFakeAgentSdk,
  FAKE_RUN_ID,
} from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import { CursorAgentError } from "../services/agent-sdk.js";

const AT = "2026-07-24T12:00:00.000Z";

let root: string;
let issuesRoot: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function conversationsDir(): string {
  return join(dirname(issuesRoot), "conversations");
}

type HeldConversationRouter = {
  server: Server;
  baseUrl: string;
  sessions: AgentSessions;
  releaseHold: () => void;
};

/** Router + sessions with a held in-flight run (shared by cancel and run-state tests). */
async function startHeldConversationRouter(): Promise<HeldConversationRouter> {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });

  const fake = createFakeAgentSdk({
    stream: buildScriptedStreamWithAgentIdHint(),
    hold,
  });
  const { createAgentSessions } = await import("../services/agent-sessions.js");
  const { createConversationsRouter } = await import("./conversations.js");
  const { errorHandler } = await import("../errors.js");
  const sessions = createAgentSessions(fake);
  const app = express();
  app.use(express.json());
  app.use("/api/conversations", createConversationsRouter(sessions));
  app.use(errorHandler);

  let heldServer: Server;
  await new Promise<void>((resolve) => {
    heldServer = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = heldServer!.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }

  return {
    server: heldServer!,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    sessions,
    releaseHold: release,
  };
}

beforeEach(async () => {
  // Nest issues/ under a unique root so conversations/ stays per-test. Using a
  // mkdtemp as ISSUES_DIR directly shared tmpdir()/conversations across workers
  // and the old afterEach wiped that shared dir (flake under parallel npm test).
  root = mkdtempSync(join(tmpdir(), "issue-tracker-conversations-route-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-conv-ws-"));
  mkdirSync(join(workspaceDir, ".git"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);

  writeIssue("platform", {
    kind: "project",
    title: "Platform",
    workspace: workspaceDir,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("no-ws", {
    kind: "project",
    title: "No workspace",
    createdAt: AT,
    updatedAt: AT,
  });

  const { createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  const { agentSessions } = await import("../services/agent-sessions.js");
  await agentSessions.disposeAll();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(root, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("conversations HTTP API (CRUD)", () => {
  it("POST creates a conversation for a workspace-backed project", async () => {
    const res = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "platform",
        title: "SDK chat",
        model: "composer-2.5",
      }),
    });
    expect(res.status).toBe(201);
    const meta = await res.json();
    expect(meta.projectId).toBe("platform");
    expect(meta.title).toBe("SDK chat");
    expect(meta.model).toBe("composer-2.5");
    expect(existsSync(join(conversationsDir(), meta.id, "meta.json"))).toBe(true);
  });

  it("POST rejects a workspaceless project with 400", async () => {
    const res = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "no-ws" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Project workspace is not set",
    });
  });

  it("GET lists conversations and GET /:id returns meta + transcript", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Listed" }),
    }).then((r) => r.json());

    const list = await fetch(`${baseUrl}/api/conversations`).then((r) => r.json());
    expect(list.some((m: { id: string }) => m.id === created.id)).toBe(true);

    const detail = await fetch(`${baseUrl}/api/conversations/${created.id}`).then(
      (r) => r.json(),
    );
    expect(detail.meta.id).toBe(created.id);
    expect(detail.transcript).toEqual([]);
  });

  it("PATCH renames and updates the model", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Before" }),
    }).then((r) => r.json());

    const patched = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "After", model: "composer-2.5" }),
    });
    expect(patched.status).toBe(200);
    const meta = await patched.json();
    expect(meta.title).toBe("After");
    expect(meta.model).toBe("composer-2.5");
  });

  it("DELETE removes the conversation directory", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Delete me" }),
    }).then((r) => r.json());

    const res = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(existsSync(join(conversationsDir(), created.id))).toBe(false);
  });

  it("GET /:id/run reports idle state and list includes activeRun: false", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Idle run state" }),
    }).then((r) => r.json());

    const runRes = await fetch(`${baseUrl}/api/conversations/${created.id}/run`);
    expect(runRes.status).toBe(200);
    expect(await runRes.json()).toEqual({
      active: false,
      runId: null,
      startedAt: null,
    });

    const list = await fetch(`${baseUrl}/api/conversations`).then((r) => r.json());
    const item = list.find((m: { id: string }) => m.id === created.id);
    expect(item?.activeRun).toBe(false);
  });

  it("GET /:id/run returns 404 for an unknown conversation id", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/unknown-conversation/run`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'unknown conversation "unknown-conversation"',
    });
  });
});

describe("GET /api/conversations/:id/events", () => {
  it("replays persisted transcript then holds the stream with pings", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "SSE replay" }),
    }).then((r) => r.json());

    const { appendEvent } = await import("../services/conversations.js");
    await appendEvent(created.id, { type: "prompt", text: "hello sse" });

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/conversations/${created.id}/events`, {
      signal: controller.signal,
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes("hello sse") && buf.includes("event: ping")) break;
    }
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // abort may already have torn the stream down
    }

    expect(buf).toContain("hello sse");
    expect(buf).toMatch(/event: ping/);
    const dataLine = buf
      .split("\n")
      .find((line) => line.startsWith("data: ") && line.includes("prompt"));
    expect(dataLine).toBeTruthy();
    const event = JSON.parse(dataLine!.slice("data: ".length));
    expect(event).toMatchObject({ type: "prompt", text: "hello sse" });
    expect(typeof event.at).toBe("string");
  });

  it("replays buffered unpersisted frames to a late SSE subscriber", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Catch-up replay" }),
    }).then((r) => r.json());

    const { publishFrame } = await import("../services/conversation-stream.js");
    publishFrame(created.id, {
      event: { type: "assistant", text: "live-only delta" },
      persist: false,
    });
    publishFrame(created.id, {
      event: { type: "run", status: "started", runId: "run-catchup" },
      persist: false,
    });

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/conversations/${created.id}/events`, {
      signal: controller.signal,
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (
        buf.includes("live-only delta") &&
        buf.includes("run-catchup") &&
        buf.includes("event: ping")
      ) {
        break;
      }
    }
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // abort may already have torn the stream down
    }

    expect(buf).toContain("live-only delta");
    expect(buf).toContain("run-catchup");
    expect(buf).toMatch(/event: ping/);
  });

  it("does not replay superseded unpersisted frames after a persisted append", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Catch-up cleared" }),
    }).then((r) => r.json());

    const { publishFrame } = await import("../services/conversation-stream.js");
    publishFrame(created.id, {
      event: { type: "assistant", text: "superseded chunk" },
      persist: false,
    });
    publishFrame(created.id, {
      event: { type: "assistant", text: "final on disk" },
      persist: true,
    });

    const { appendEvent } = await import("../services/conversations.js");
    await appendEvent(created.id, {
      type: "assistant",
      text: "final on disk",
    });

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/conversations/${created.id}/events`, {
      signal: controller.signal,
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes("event: ping")) break;
    }
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // abort may already have torn the stream down
    }

    expect(buf).toContain("final on disk");
    expect(buf).not.toContain("superseded chunk");
    expect(
      buf.split("\n").filter((line) => line.includes("final on disk")).length,
    ).toBe(1);
  });

  it("forwards live normalized frames while a run is active", async () => {
    const fake = createFakeAgentSdk({
      stream: buildScriptedStreamWithAgentIdHint(),
    });
    const { createAgentSessions } = await import("../services/agent-sessions.js");
    const { createConversationsRouter } = await import("./conversations.js");
    const { errorHandler } = await import("../errors.js");
    const sessions = createAgentSessions(fake);
    const app = express();
    app.use(express.json());
    app.use("/api/conversations", createConversationsRouter(sessions));
    app.use(errorHandler);

    let liveServer: Server;
    await new Promise<void>((resolve) => {
      liveServer = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = liveServer!.address();
    if (!addr || typeof addr === "string") {
      throw new Error("expected TCP listen address");
    }
    const liveBase = `http://127.0.0.1:${addr.port}`;

    try {
      const created = await fetch(`${liveBase}/api/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "platform", title: "SSE live" }),
      }).then((r) => r.json());

      const controller = new AbortController();
      const eventsRes = await fetch(
        `${liveBase}/api/conversations/${created.id}/events`,
        {
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        },
      );
      expect(eventsRes.status).toBe(200);

      const send = await fetch(`${liveBase}/api/conversations/${created.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "stream please" }),
      });
      expect(send.status).toBe(202);

      const reader = eventsRes.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes('"type":"assistant"') && buf.includes("event: ping")) {
          break;
        }
      }
      controller.abort();
      try {
        await reader.cancel();
      } catch {
        // abort may already have torn the stream down
      }

      expect(buf).toContain('"type":"assistant"');
      expect(buf).toMatch(/event: ping/);
      // Connection must stay open for heartbeats; we only closed via client abort.
      expect(buf).not.toMatch(/event: end/);
    } finally {
      await sessions.disposeAll();
      await new Promise<void>((resolve, reject) => {
        liveServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

describe("POST /api/conversations/:id/cancel", () => {
  let cancelServer: Server;
  let cancelBaseUrl: string;
  let releaseHold: () => void;
  let cancelSessions: AgentSessions;

  beforeEach(async () => {
    const held = await startHeldConversationRouter();
    cancelServer = held.server;
    cancelBaseUrl = held.baseUrl;
    cancelSessions = held.sessions;
    releaseHold = held.releaseHold;
  });

  afterEach(async () => {
    releaseHold();
    await cancelSessions.disposeAll();
    await new Promise<void>((resolve, reject) => {
      cancelServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns 409 when there is no active run", async () => {
    const created = await fetch(`${cancelBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Idle cancel" }),
    }).then((r) => r.json());

    const res = await fetch(
      `${cancelBaseUrl}/api/conversations/${created.id}/cancel`,
      { method: "POST" },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "No active run to cancel" });
  });

  it("returns 200 and stops an in-flight run while SSE stays open", async () => {
    const created = await fetch(`${cancelBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Cancel run" }),
    }).then((r) => r.json());

    const controller = new AbortController();
    const eventsRes = await fetch(
      `${cancelBaseUrl}/api/conversations/${created.id}/events`,
      {
        signal: controller.signal,
        headers: { accept: "text/event-stream" },
      },
    );
    expect(eventsRes.status).toBe(200);

    const send = await fetch(
      `${cancelBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "long turn" }),
      },
    );
    expect(send.status).toBe(202);

    await Promise.resolve();

    const cancel = await fetch(
      `${cancelBaseUrl}/api/conversations/${created.id}/cancel`,
      { method: "POST" },
    );
    expect(cancel.status).toBe(200);

    const reader = eventsRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes("event: ping")) break;
    }
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // abort may already have torn the stream down
    }

    expect(buf).toMatch(/event: ping/);
    expect(buf).not.toContain('"type":"assistant"');
    expect(buf).not.toMatch(/event: end/);

    const secondCancel = await fetch(
      `${cancelBaseUrl}/api/conversations/${created.id}/cancel`,
      { method: "POST" },
    );
    expect(secondCancel.status).toBe(409);
  });

  it("reports active: true from /run and list while a run is in flight", async () => {
    const created = await fetch(`${cancelBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Active run state" }),
    }).then((r) => r.json());

    const send = await fetch(`${cancelBaseUrl}/api/conversations/${created.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hold please" }),
    });
    expect(send.status).toBe(202);

    await Promise.resolve();

    const runRes = await fetch(`${cancelBaseUrl}/api/conversations/${created.id}/run`);
    expect(runRes.status).toBe(200);
    const runState = await runRes.json();
    expect(runState).toMatchObject({
      active: true,
      runId: FAKE_RUN_ID,
    });
    expect(typeof runState.startedAt).toBe("string");

    const list = await fetch(`${cancelBaseUrl}/api/conversations`).then((r) => r.json());
    const item = list.find((m: { id: string }) => m.id === created.id);
    expect(item?.activeRun).toBe(true);
  });
});

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

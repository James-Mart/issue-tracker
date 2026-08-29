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
  writeIssue("capture", {
    kind: "idea",
    title: "Capture",
    partOf: "platform",
    order: 0,
    archived: false,
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
      code: "validation",
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

  it("PATCH archives a conversation and rejects a non-boolean archived value", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Archive via API" }),
    }).then((r) => r.json());

    const bad = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: "true" }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "archived must be a boolean" });

    const patched = await fetch(`${baseUrl}/api/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ archived: true });
    expect(
      existsSync(join(conversationsDir(), created.id, "meta.json")),
    ).toBe(true);
  });

  it("GET omits issue-anchored conversations with and without showArchived", async () => {
    const unanchored = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Free-form chat" }),
    }).then((r) => r.json());
    const anchored = await fetch(
      `${baseUrl}/api/issues/capture/channels/planning/sessions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "composer-2.5", title: "Anchored chat" }),
      },
    ).then((r) => r.json());

    const defaultList = await fetch(`${baseUrl}/api/conversations`).then((r) =>
      r.json(),
    );
    expect(defaultList.map((m: { id: string }) => m.id)).toEqual([unanchored.id]);

    const archivedList = await fetch(
      `${baseUrl}/api/conversations?showArchived=true`,
    ).then((r) => r.json());
    expect(archivedList.map((m: { id: string }) => m.id)).toEqual([
      unanchored.id,
    ]);
    expect(archivedList.some((m: { id: string }) => m.id === anchored.id)).toBe(
      false,
    );
  });

  it("GET omits archived conversations unless showArchived=true", async () => {
    const visible = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Visible chat" }),
    }).then((r) => r.json());
    const hidden = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Hidden chat" }),
    }).then((r) => r.json());

    await fetch(`${baseUrl}/api/conversations/${hidden.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });

    const defaultList = await fetch(`${baseUrl}/api/conversations`).then((r) =>
      r.json(),
    );
    expect(defaultList.map((m: { id: string }) => m.id)).toEqual([visible.id]);

    const allList = await fetch(
      `${baseUrl}/api/conversations?showArchived=true`,
    ).then((r) => r.json());
    expect(allList.map((m: { id: string }) => m.id).sort()).toEqual(
      [visible.id, hidden.id].sort(),
    );
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
      code: "not_found",
    });
  });

  it("POST without message creates an idle conversation with an empty transcript", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "platform",
        title: "Idle create",
        model: "composer-2.5",
      }),
    });
    expect(created.status).toBe(201);
    const meta = await created.json();

    const run = await fetch(`${baseUrl}/api/conversations/${meta.id}/run`).then(
      (r) => r.json(),
    );
    expect(run).toEqual({
      active: false,
      runId: null,
      startedAt: null,
    });

    const detail = await fetch(`${baseUrl}/api/conversations/${meta.id}`).then(
      (r) => r.json(),
    );
    expect(detail.transcript).toEqual([]);
  });
});

describe("POST /api/conversations with message", () => {
  let messageServer: Server;
  let messageBaseUrl: string;
  let messageSessions: AgentSessions;
  let releaseHold: () => void;

  beforeEach(async () => {
    const held = await startHeldConversationRouter();
    messageServer = held.server;
    messageBaseUrl = held.baseUrl;
    messageSessions = held.sessions;
    releaseHold = held.releaseHold;
  });

  afterEach(async () => {
    releaseHold();
    await messageSessions.disposeAll();
    await new Promise<void>((resolve, reject) => {
      messageServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("persists the prompt and starts a run", async () => {
    const created = await fetch(`${messageBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "platform",
        title: "Vision refinement",
        model: "composer-2.5",
        message: "Refine vision for platform",
      }),
    });
    expect(created.status).toBe(201);
    const meta = await created.json();

    expect(messageSessions.getActiveRun(meta.id)).toBeTruthy();

    const detail = await fetch(
      `${messageBaseUrl}/api/conversations/${meta.id}`,
    ).then((r) => r.json());
    expect(detail.transcript).toEqual([
      expect.objectContaining({
        type: "prompt",
        text: "Refine vision for platform",
      }),
    ]);
  });
});

describe("GET /api/conversations/:id/transcript", () => {
  it("honors sinceSeq and reports latestSeq", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Transcript page" }),
    }).then((r) => r.json());

    const { appendEvent } = await import("../services/conversations.js");
    const first = await appendEvent(created.id, {
      type: "prompt",
      text: "one",
    });
    const second = await appendEvent(created.id, {
      type: "assistant",
      text: "two",
    });
    const third = await appendEvent(created.id, {
      type: "assistant",
      text: "three",
    });

    const all = await fetch(
      `${baseUrl}/api/conversations/${created.id}/transcript`,
    ).then((r) => r.json());
    expect(all.latestSeq).toBe(third.seq);
    expect(all.events.map((e: { text: string }) => e.text)).toEqual([
      "one",
      "two",
      "three",
    ]);

    const page = await fetch(
      `${baseUrl}/api/conversations/${created.id}/transcript?sinceSeq=${first.seq}`,
    ).then((r) => r.json());
    expect(page.latestSeq).toBe(third.seq);
    expect(page.events.map((e: { text: string; seq: number }) => e)).toEqual([
      expect.objectContaining({ text: "two", seq: second.seq }),
      expect.objectContaining({ text: "three", seq: third.seq }),
    ]);

    const empty = await fetch(
      `${baseUrl}/api/conversations/${created.id}/transcript?sinceSeq=${third.seq}`,
    ).then((r) => r.json());
    expect(empty).toEqual({ events: [], latestSeq: third.seq });
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

  it("returns 200 and stops an in-flight run", async () => {
    const created = await fetch(`${cancelBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Cancel run" }),
    }).then((r) => r.json());

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

  it("stores a pending message during an active run without appending a prompt", async () => {
    const created = await fetch(`${pendingBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Pending send" }),
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

    const pending = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "  queued turn  " }),
      },
    );
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ pending: true });

    const detail = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(detail.meta.pendingMessage?.text).toBe("queued turn");
    expect(
      detail.transcript.filter((e: { type: string }) => e.type === "prompt"),
    ).toEqual([expect.objectContaining({ type: "prompt", text: "hold please" })]);
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

    const queued = await fetch(
      `${pendingBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "fire me later" }),
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

describe("POST /api/conversations/:id/interrupt", () => {
  let interruptServer: Server;
  let interruptBaseUrl: string;
  let interruptSessions: AgentSessions;
  let releaseHold: () => void;

  beforeEach(async () => {
    const held = await startHeldConversationRouter();
    interruptServer = held.server;
    interruptBaseUrl = held.baseUrl;
    interruptSessions = held.sessions;
    releaseHold = held.releaseHold;
  });

  afterEach(async () => {
    releaseHold();
    await interruptSessions.disposeAll();
    await new Promise<void>((resolve, reject) => {
      interruptServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns 400 when prompt is missing or empty", async () => {
    const created = await fetch(`${interruptBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Interrupt bad" }),
    }).then((r) => r.json());

    const missing = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}/interrupt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(missing.status).toBe(400);

    const empty = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}/interrupt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "   " }),
      },
    );
    expect(empty.status).toBe(400);
  });

  it("sends normally when no run is active", async () => {
    const created = await fetch(`${interruptBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Interrupt idle" }),
    }).then((r) => r.json());

    const res = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}/interrupt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "plain send" }),
      },
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId: FAKE_RUN_ID });

    const detail = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(
      detail.transcript.filter((e: { type: string }) => e.type === "prompt"),
    ).toEqual([expect.objectContaining({ type: "prompt", text: "plain send" })]);
  });

  it("cancels the active run, clears pending, appends the prompt, and starts a new run", async () => {
    const created = await fetch(`${interruptBaseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Interrupt redirect" }),
    }).then((r) => r.json());

    const first = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hold please" }),
      },
    );
    expect(first.status).toBe(202);
    await Promise.resolve();

    const queued = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "stale queued" }),
      },
    );
    expect(queued.status).toBe(202);
    expect(await queued.json()).toEqual({ pending: true });

    let detail = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(detail.meta.pendingMessage?.text).toBe("stale queued");

    const runBefore = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}/run`,
    ).then((r) => r.json());
    expect(runBefore.active).toBe(true);

    const interrupt = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}/interrupt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "redirect now" }),
      },
    );
    expect(interrupt.status).toBe(202);
    expect(await interrupt.json()).toEqual({ runId: FAKE_RUN_ID });

    detail = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}`,
    ).then((r) => r.json());
    expect(detail.meta.pendingMessage).toBeUndefined();
    expect(
      detail.transcript.filter((e: { type: string }) => e.type === "prompt").map(
        (e: { text: string }) => e.text,
      ),
    ).toEqual(["hold please", "redirect now"]);

    const runAfter = await fetch(
      `${interruptBaseUrl}/api/conversations/${created.id}/run`,
    ).then((r) => r.json());
    expect(runAfter.active).toBe(true);

    releaseHold();
    for (let i = 0; i < 50; i += 1) {
      detail = await fetch(
        `${interruptBaseUrl}/api/conversations/${created.id}`,
      ).then((r) => r.json());
      const prompts = detail.transcript.filter(
        (e: { type: string }) => e.type === "prompt",
      );
      if (
        detail.meta.pendingMessage === undefined &&
        prompts.length === 2 &&
        !prompts.some((e: { text: string }) => e.text === "stale queued")
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(
      detail!.transcript.filter((e: { type: string }) => e.type === "prompt").map(
        (e: { text: string }) => e.text,
      ),
    ).toEqual(["hold please", "redirect now"]);
  });
});

describe("published conversation payload validation", () => {
  it("returns 500 when the list payload fails conversationListItemSchema", async () => {
    const conversations = await import("../services/conversations.js");
    vi.spyOn(conversations, "listConversations").mockReturnValue([
      {
        id: "bad",
        title: "",
        projectId: "platform",
        model: "composer-2.5",
        createdAt: AT,
        updatedAt: AT,
        archived: false,
      },
    ]);

    const res = await fetch(`${baseUrl}/api/conversations`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});

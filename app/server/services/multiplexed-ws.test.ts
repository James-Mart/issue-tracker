import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerToClientMessage } from "./multiplexed-ws.js";

const AT = "2026-07-24T12:00:00.000Z";

let root: string;
let issuesRoot: string;
let workspaceDir: string;
let server: Server;
let baseUrl: string;
let wsUrl: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

async function openSocket(): Promise<WebSocket> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener(
      "error",
      () => reject(new Error("WebSocket open failed")),
      { once: true },
    );
  });
  return ws;
}

function collectMessages(ws: WebSocket): ServerToClientMessage[] {
  const messages: ServerToClientMessage[] = [];
  ws.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)) as ServerToClientMessage);
  });
  return messages;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function diagnostics(): Promise<{
  connections: number;
  subscriptions: number;
}> {
  return fetch(`${baseUrl}/api/diagnostics/connections`).then((r) => r.json());
}

async function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
    ws.close();
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-multiplexed-ws-"));
  issuesRoot = join(root, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  workspaceDir = mkdtempSync(join(tmpdir(), "issue-ws-workspace-"));
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

  const { attachMultiplexedWebSocket, createApp } = await import("../app.js");
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  attachMultiplexedWebSocket(server);
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
  wsUrl = `ws://127.0.0.1:${addr.port}/api/ws`;
});

afterEach(async () => {
  const { agentSessions } = await import("./agent-sessions.js");
  await agentSessions.disposeAll();
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  rmSync(root, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("multiplexed WebSocket endpoint", () => {
  it("delivers events for two topics on one connection", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "platform",
        title: "Multiplex topics",
      }),
    }).then((r) => r.json());

    const ws = await openSocket();
    const messages = collectMessages(ws);
    const conversationTopic = `conversation:${created.id}`;

    ws.send(JSON.stringify({ type: "subscribe", topic: conversationTopic }));
    ws.send(JSON.stringify({ type: "subscribe", topic: "issues" }));

    await waitFor(async () => {
      const diag = await diagnostics();
      return diag.connections === 1 && diag.subscriptions === 2;
    }, "two subscriptions");

    const { publishFrame } = await import("./conversation-stream.js");
    publishFrame(created.id, {
      event: { type: "assistant", text: "from-conversation" },
      persist: false,
    });
    publishFrame("issues", {
      event: { type: "change", id: "platform", scope: "issue" },
      persist: false,
    });

    await waitFor(
      () =>
        messages.some(
          (m) =>
            m.type === "event" &&
            m.topic === conversationTopic &&
            (m.event as { text?: string }).text === "from-conversation",
        ) &&
        messages.some(
          (m) =>
            m.type === "event" &&
            m.topic === "issues" &&
            (m.event as { id?: string }).id === "platform",
        ),
      "events on both topics",
    );

    const conversationEvent = messages.find(
      (m) => m.type === "event" && m.topic === conversationTopic,
    );
    const issuesEvent = messages.find(
      (m) => m.type === "event" && m.topic === "issues",
    );
    expect(conversationEvent).toMatchObject({
      type: "event",
      topic: conversationTopic,
      event: { type: "assistant", text: "from-conversation" },
    });
    expect(conversationEvent).toEqual(
      expect.objectContaining({ type: "event", seq: expect.any(Number) }),
    );
    expect(issuesEvent).toMatchObject({
      type: "event",
      topic: "issues",
      event: { type: "change", id: "platform", scope: "issue" },
    });

    await closeSocket(ws);
  });

  it("answers reset when sinceSeq is older than the catch-up window", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "platform",
        title: "Multiplex reset",
      }),
    }).then((r) => r.json());

    const {
      publishFrame,
      CATCHUP_BUFFER_MAX_FRAMES,
    } = await import("./conversation-stream.js");
    for (let i = 0; i < CATCHUP_BUFFER_MAX_FRAMES + 5; i += 1) {
      publishFrame(created.id, {
        event: { type: "assistant" as const, text: `live-${i}` },
        persist: false,
      });
    }

    const ws = await openSocket();
    const messages = collectMessages(ws);
    const topic = `conversation:${created.id}`;
    ws.send(JSON.stringify({ type: "subscribe", topic, sinceSeq: 0 }));

    await waitFor(
      () => messages.some((m) => m.type === "reset" && m.topic === topic),
      "reset for over-old sinceSeq",
    );
    expect(messages.filter((m) => m.type === "event")).toHaveLength(0);

    await closeSocket(ws);
  });

  it("tracks diagnostics counts across connect and disconnect", async () => {
    expect(await diagnostics()).toEqual({ connections: 0, subscriptions: 0 });

    const ws = await openSocket();
    await waitFor(
      async () => (await diagnostics()).connections === 1,
      "one connection",
    );
    expect(await diagnostics()).toEqual({ connections: 1, subscriptions: 0 });

    ws.send(JSON.stringify({ type: "subscribe", topic: "issues" }));
    await waitFor(
      async () => (await diagnostics()).subscriptions === 1,
      "one subscription",
    );
    expect(await diagnostics()).toEqual({ connections: 1, subscriptions: 1 });

    await closeSocket(ws);
    await waitFor(async () => {
      const diag = await diagnostics();
      return diag.connections === 0 && diag.subscriptions === 0;
    }, "disconnect clears diagnostics");
    expect(await diagnostics()).toEqual({ connections: 0, subscriptions: 0 });
  });
});

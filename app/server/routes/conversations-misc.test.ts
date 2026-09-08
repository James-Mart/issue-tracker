import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_RUN_ID } from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import {
  AT,
  baseUrl,
  startHeldConversationRouter,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures();

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

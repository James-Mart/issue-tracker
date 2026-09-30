import { writeFileSync } from "fs";
import type { Server } from "http";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_RUN_ID } from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import { DEFAULT_TRANSCRIPT_PAGE_LIMIT } from "../services/transcript-page.js";
import {
  AT,
  baseUrl,
  conversationsDir,
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
    expect(all.hasMore).toBe(false);
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
    expect(empty).not.toHaveProperty("hasMore");
  });

  it("returns the newest limit events before a seq, ascending, with hasMore", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Paged transcript" }),
    }).then((r) => r.json());

    const lines = Array.from({ length: 6 }, (_, i) =>
      JSON.stringify({
        type: "assistant",
        text: `n${i + 1}`,
        at: AT,
        seq: i + 1,
      }),
    );
    writeFileSync(
      join(conversationsDir(), created.id, "transcript.jsonl"),
      `${lines.join("\n")}\n`,
    );

    const page = await fetch(
      `${baseUrl}/api/conversations/${created.id}/transcript?before=5&limit=2`,
    ).then((r) => r.json());
    expect(page.latestSeq).toBe(6);
    expect(page.hasMore).toBe(true);
    expect(page.events.map((e: { text: string; seq: number }) => e)).toEqual([
      expect.objectContaining({ text: "n3", seq: 3 }),
      expect.objectContaining({ text: "n4", seq: 4 }),
    ]);

    const newest = await fetch(
      `${baseUrl}/api/conversations/${created.id}/transcript?limit=2`,
    ).then((r) => r.json());
    expect(newest).toMatchObject({
      latestSeq: 6,
      hasMore: true,
    });
    expect(newest.events.map((e: { seq: number }) => e.seq)).toEqual([5, 6]);
  });

  it("defaults limit and rejects a non-positive or non-integer before or limit", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Default page" }),
    }).then((r) => r.json());

    const total = DEFAULT_TRANSCRIPT_PAGE_LIMIT + 2;
    const lines = Array.from({ length: total }, (_, i) =>
      JSON.stringify({
        type: "assistant",
        text: `d${i + 1}`,
        at: AT,
        seq: i + 1,
      }),
    );
    writeFileSync(
      join(conversationsDir(), created.id, "transcript.jsonl"),
      `${lines.join("\n")}\n`,
    );

    const page = await fetch(
      `${baseUrl}/api/conversations/${created.id}/transcript`,
    ).then((r) => r.json());
    expect(page.hasMore).toBe(true);
    expect(page.latestSeq).toBe(total);
    expect(page.events).toHaveLength(DEFAULT_TRANSCRIPT_PAGE_LIMIT);
    expect(page.events[0].seq).toBe(total - DEFAULT_TRANSCRIPT_PAGE_LIMIT + 1);
    expect(page.events.at(-1).seq).toBe(total);

    for (const query of [
      "before=0",
      "before=-3",
      "before=1.5",
      "before=nope",
      "limit=0",
      "limit=-1",
      "limit=2.2",
      "limit=nope",
    ]) {
      const res = await fetch(
        `${baseUrl}/api/conversations/${created.id}/transcript?${query}`,
      );
      expect(res.status, query).toBe(400);
      const body = await res.json();
      expect(body.error, query).toMatch(/must be a positive integer/);
    }
  });

  it("rejects sinceSeq combined with before or limit", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Mixed cursor" }),
    }).then((r) => r.json());

    const withBefore = await fetch(
      `${baseUrl}/api/conversations/${created.id}/transcript?sinceSeq=1&before=4`,
    );
    expect(withBefore.status).toBe(400);
    expect(await withBefore.json()).toEqual({
      error: "sinceSeq cannot be combined with before",
    });

    const withLimit = await fetch(
      `${baseUrl}/api/conversations/${created.id}/transcript?sinceSeq=1&limit=2`,
    );
    expect(withLimit.status).toBe(400);
    expect(await withLimit.json()).toEqual({
      error: "sinceSeq cannot be combined with limit",
    });
  });

  it("returns 404 for an unknown conversation", async () => {
    const res = await fetch(`${baseUrl}/api/conversations/missing-thread/transcript`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'unknown conversation "missing-thread"',
      code: "not_found",
    });
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

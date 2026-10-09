import { writeFileSync } from "fs";
import type { Server } from "http";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentSessions } from "../services/agent-sessions.js";
import {
  AT,
  baseUrl,
  conversationsDir,
  startHeldConversationRouter,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures();

describe("GET /api/conversations/:id/transcript", () => {
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
});

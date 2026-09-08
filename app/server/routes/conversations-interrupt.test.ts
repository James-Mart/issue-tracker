import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAKE_RUN_ID } from "../services/agent-sdk.fake.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import {
  startHeldConversationRouter,
  useConversationsTestFixtures,
} from "./conversations.test-harness.js";

useConversationsTestFixtures();

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

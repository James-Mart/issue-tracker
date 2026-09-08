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

async function uploadConversationAttachment(
  apiBaseUrl: string,
  conversationId: string,
  filename: string,
  body: string,
): Promise<void> {
  const form = new FormData();
  form.append(
    "attachment",
    new Blob([new TextEncoder().encode(body)]),
    filename,
  );
  const res = await fetch(
    `${apiBaseUrl}/api/conversations/${conversationId}/attachments`,
    { method: "POST", body: form },
  );
  expect(res.status).toBe(201);
}

describe("POST /api/conversations/:id/messages with attachments", () => {
  it("persists attachments on the prompt event", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Attach send" }),
    }).then((r) => r.json());

    await uploadConversationAttachment(baseUrl, created.id, "mock.tsx", "export const x = 1;\n");

    const send = await fetch(
      `${baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "review this",
          attachments: ["mock.tsx"],
        }),
      },
    );
    expect(send.status).toBe(202);

    const detail = await fetch(`${baseUrl}/api/conversations/${created.id}`).then(
      (r) => r.json(),
    );
    const prompt = detail.transcript.find(
      (e: { type: string }) => e.type === "prompt",
    );
    expect(prompt).toMatchObject({
      type: "prompt",
      text: "review this",
      attachments: ["mock.tsx"],
    });
  });

  it("returns 400 for unknown attachment names", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Missing attach" }),
    }).then((r) => r.json());

    const send = await fetch(
      `${baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "hello",
          attachments: ["ghost.png"],
        }),
      },
    );
    expect(send.status).toBe(400);
    expect(await send.json()).toEqual({
      error: "attachment not found: ghost.png",
    });
  });

  it("accepts an attachments-only send", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Attach only" }),
    }).then((r) => r.json());

    await uploadConversationAttachment(baseUrl, created.id, "notes.txt", "context\n");

    const send = await fetch(
      `${baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "", attachments: ["notes.txt"] }),
      },
    );
    expect(send.status).toBe(202);

    const detail = await fetch(`${baseUrl}/api/conversations/${created.id}`).then(
      (r) => r.json(),
    );
    const prompt = detail.transcript.find(
      (e: { type: string }) => e.type === "prompt",
    );
    expect(prompt).toMatchObject({
      type: "prompt",
      text: "",
      attachments: ["notes.txt"],
    });
  });

  it("rejects a send with neither prompt nor attachments", async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "platform", title: "Empty send" }),
    }).then((r) => r.json());

    const send = await fetch(
      `${baseUrl}/api/conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "   ", attachments: [] }),
      },
    );
    expect(send.status).toBe(400);
    expect(await send.json()).toEqual({ error: "prompt is required" });
  });

  it("queues attachments on a pending message and delivers them when the run drains", async () => {
    const held = await startHeldConversationRouter();
    try {
      const created = await fetch(`${held.baseUrl}/api/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "platform", title: "Pending attach" }),
      }).then((r) => r.json());

      await uploadConversationAttachment(
        held.baseUrl,
        created.id,
        "mock.tsx",
        "export const x = 1;\n",
      );

      const first = await fetch(
        `${held.baseUrl}/api/conversations/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: "hold please" }),
        },
      );
      expect(first.status).toBe(202);
      await Promise.resolve();

      const queued = await fetch(
        `${held.baseUrl}/api/conversations/${created.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt: "review",
            attachments: ["mock.tsx"],
          }),
        },
      );
      expect(queued.status).toBe(202);
      expect(await queued.json()).toEqual({ pending: true });

      let detail: {
        meta: { pendingMessage?: { attachments?: string[] } };
        transcript: { type: string; attachments?: string[]; text?: string }[];
      };
      detail = await fetch(`${held.baseUrl}/api/conversations/${created.id}`).then(
        (r) => r.json(),
      );
      expect(detail.meta.pendingMessage?.attachments).toEqual(["mock.tsx"]);

      held.releaseHold();

      for (let i = 0; i < 50; i += 1) {
        detail = await fetch(`${held.baseUrl}/api/conversations/${created.id}`).then(
          (r) => r.json(),
        );
        const prompts = detail.transcript.filter((e) => e.type === "prompt");
        if (
          detail.meta.pendingMessage === undefined &&
          prompts.some((e) => e.attachments?.includes("mock.tsx"))
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(detail!.meta.pendingMessage).toBeUndefined();
      expect(
        detail!.transcript.filter((e) => e.type === "prompt").map((e) => ({
          text: e.text,
          attachments: e.attachments,
        })),
      ).toEqual([
        { text: "hold please", attachments: undefined },
        { text: "review", attachments: ["mock.tsx"] },
      ]);
    } finally {
      await held.sessions.disposeAll();
      await new Promise<void>((resolve, reject) => {
        held.server.close((err) => (err ? reject(err) : resolve()));
      });
    }
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

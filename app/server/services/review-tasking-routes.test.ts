import type { Server } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import {
  REVIEW_ID,
  seedReviewTasking as seed,
  useReviewTaskingStore,
} from "./review-tasking.test-fixtures.js";

describe("review submission routes", () => {
  useReviewTaskingStore("issue-tracker-review-tasking-http-");

  let server: Server;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("mounts submit and refuses when nothing is ready", async () => {
    seed();
    const { createApp } = await import("../app.js");
    const { NO_READY_THREADS_ERROR } = await import("./review-tasking.js");
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP listen address");

    const res = await fetch(
      `http://127.0.0.1:${addr.port}/api/projects/p/reviews/${REVIEW_ID}/submissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "validation",
      error: NO_READY_THREADS_ERROR,
    });
  });

  it("responds with a tasking submission before the tasker starts", async () => {
    seed();
    let started = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sessions = {
      getActiveRun: () => undefined,
      sendPrompt: async () => {
        started = true;
        await gate;
        return { ok: true as const, run: { id: "run-1" } as never };
      },
    } as unknown as AgentSessions;
    const { appendComment } = await import("./issues.js");
    const { createApp } = await import("../app.js");
    const comment = await appendComment("s", { role: "human", body: "Fix it" });
    const app = createApp(sessions);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP listen address");

    try {
      const res = await fetch(
        `http://127.0.0.1:${addr.port}/api/projects/p/reviews/${REVIEW_ID}/submissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: "Ship it" }),
        },
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        submissions: { status: string; threadIds: string[]; conversationId?: string }[];
      };
      expect(body.submissions[0]).toMatchObject({
        status: "tasking",
        threadIds: [comment.id],
      });
      expect(body.submissions[0]?.conversationId).toBeUndefined();
      await vi.waitFor(() => expect(started).toBe(true));
    } finally {
      release();
    }
  });
});

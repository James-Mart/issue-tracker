import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "../services/agent-sessions.js";

let server: Server;
let baseUrl: string;
let initiateRestart: ReturnType<typeof vi.fn>;

function stubSessions(
  listActiveRuns: AgentSessions["listActiveRuns"],
): AgentSessions {
  return {
    sendPrompt: vi.fn(),
    getActiveRun: vi.fn(),
    listActiveRuns,
    cancel: vi.fn(),
    dispose: vi.fn(),
    disposeAll: vi.fn(),
  };
}

async function startApp(
  sessions?: AgentSessions,
  options?: { supervised?: boolean },
): Promise<void> {
  vi.resetModules();
  const { createApp } = await import("../app.js");
  if (options?.supervised) {
    const { captureRestartSupervision } = await import("../restart-contract.js");
    captureRestartSupervision(true);
  }
  const app = createApp(sessions, initiateRestart);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function postRestart(body?: { force?: boolean }) {
  return fetch(`${baseUrl}/api/restart`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  initiateRestart = vi.fn();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("POST /api/restart", () => {
  it("accepts when supervised and calls initiateRestart after the response", async () => {
    await startApp(stubSessions(() => []), { supervised: true });

    const res = await postRestart();
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.bootId).toEqual(expect.any(String));
    expect(body.bootId.length).toBeGreaterThan(0);
    expect(initiateRestart).toHaveBeenCalledOnce();
  });

  it("refuses when unsupervised and never calls initiateRestart", async () => {
    await startApp(stubSessions(() => []));

    const res = await postRestart();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "not-supervised" });
    expect(initiateRestart).not.toHaveBeenCalled();
  });

  it("refuses as runs-in-flight when live turns exist and force is not set", async () => {
    const conversationId = "conv-live-turn";
    await startApp(stubSessions(() => [{ conversationId }]), {
      supervised: true,
    });

    const res = await postRestart();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "runs-in-flight",
      activeRuns: [{ conversationId }],
    });
    expect(initiateRestart).not.toHaveBeenCalled();
  });

  it("accepts with force when live turns exist", async () => {
    await startApp(stubSessions(() => [{ conversationId: "conv-live-turn" }]), {
      supervised: true,
    });

    const res = await postRestart({ force: true });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(
      expect.objectContaining({ bootId: expect.any(String) }),
    );
    expect(initiateRestart).toHaveBeenCalledOnce();
  });

  it("refuses unsupervised even when force is true", async () => {
    await startApp(
      stubSessions(() => [{ conversationId: "conv-live-turn" }]),
    );

    const res = await postRestart({ force: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "not-supervised" });
    expect(initiateRestart).not.toHaveBeenCalled();
  });
});

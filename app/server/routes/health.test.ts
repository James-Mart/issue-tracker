import type { Server } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "../services/agent-sessions.js";
import { RESTART_SUPERVISED_ENV_VAR } from "../restart-contract.js";

let server: Server;
let baseUrl: string;
let initiateRestart: ReturnType<typeof vi.fn>;

function stubSessions(): AgentSessions {
  return {
    sendPrompt: vi.fn(),
    getActiveRun: vi.fn(),
    listActiveRuns: () => [],
    cancel: vi.fn(),
    dispose: vi.fn(),
    disposeAll: vi.fn(),
  };
}

async function startApp(): Promise<void> {
  vi.resetModules();
  initiateRestart = vi.fn();
  const { createApp } = await import("../app.js");
  const app = createApp(stubSessions(), initiateRestart);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function getHealth() {
  return fetch(`${baseUrl}/api/health`);
}

async function postRestart() {
  return fetch(`${baseUrl}/api/restart`, { method: "POST" });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("GET /api/health", () => {
  it("returns boot identity and restart support", async () => {
    vi.stubEnv(RESTART_SUPERVISED_ENV_VAR, "1");
    await startApp();

    const first = await getHealth();
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.bootId).toEqual(expect.any(String));
    expect(firstBody.bootId.length).toBeGreaterThan(0);
    expect(() => new Date(firstBody.startedAt)).not.toThrow();
    expect(new Date(firstBody.startedAt).toISOString()).toBe(
      firstBody.startedAt,
    );
    expect(firstBody.restartSupported).toBe(true);

    const second = await getHealth();
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.bootId).toBe(firstBody.bootId);

    const restart = await postRestart();
    expect(restart.status).toBe(202);
    const restartBody = await restart.json();
    expect(restartBody.bootId).toBe(firstBody.bootId);
  });

  it("reports restartSupported false when unsupervised", async () => {
    await startApp();

    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.restartSupported).toBe(false);
  });
});

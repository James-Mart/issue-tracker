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

async function startSupervisedApp(sessions: AgentSessions): Promise<void> {
  vi.resetModules();
  const { createApp } = await import("../app.js");
  const { captureRestartSupervision } = await import("../restart-contract.js");
  captureRestartSupervision(true);
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

async function postRestart() {
  return fetch(`${baseUrl}/api/restart`, { method: "POST" });
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
  it("refuses as runs-in-flight when live turns exist and force is not set", async () => {
    const conversationId = "conv-live-turn";
    await startSupervisedApp(stubSessions(() => [{ conversationId }]));

    const res = await postRestart();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "runs-in-flight",
      activeRuns: [{ conversationId }],
    });
    expect(initiateRestart).not.toHaveBeenCalled();
  });
});

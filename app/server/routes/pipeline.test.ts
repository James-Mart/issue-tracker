import type { Server } from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "../services/agent-sessions.js";
import { pluginDir } from "../config.js";

let server: Server;
let baseUrl: string;

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
  const { createApp } = await import("../app.js");
  const app = createApp(stubSessions());
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("expected TCP listen address");
  }
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function getStepSource(stepId: string) {
  return fetch(`${baseUrl}/api/pipeline/steps/${encodeURIComponent(stepId)}/source`);
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("GET /api/pipeline/steps/:stepId/source", () => {
  it("returns a declared step's source path and markdown", async () => {
    await startApp();

    const res = await getStepSource("implement");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("agents/_issue-tracker-implementor.md");
    expect(body.markdown).toBe(
      readFileSync(
        join(pluginDir, "agents/_issue-tracker-implementor.md"),
        "utf8",
      ),
    );
  });

  it("returns 404 for an unknown step id", async () => {
    await startApp();

    const res = await getStepSource("not-a-step");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });

  it("returns 404 for a handoff node", async () => {
    await startApp();

    const res = await getStepSource("work-handoff");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("not_found");
  });
});

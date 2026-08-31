import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "../services/agent-sessions.js";
import { BACKUP_STALE_AFTER_MS } from "../services/store-backup-status.js";

let server: Server;
let baseUrl: string;
let storeRoot: string;
let issuesRoot: string;

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

function setupStore(): void {
  storeRoot = mkdtempSync(join(tmpdir(), "issue-tracker-backup-route-"));
  issuesRoot = join(storeRoot, "issues");
  mkdirSync(issuesRoot, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesRoot);
}

function writeConfig(backup: { remote: string | null; enabled: boolean }): void {
  writeFileSync(
    join(storeRoot, "app-config.json"),
    `${JSON.stringify({ backup }, null, 2)}\n`,
  );
}

function writeStatus(status: {
  lastSuccessAt: string | null;
  state: "idle" | "retrying" | "diverged";
  error: string | null;
}): void {
  writeFileSync(
    join(storeRoot, "backup-status.json"),
    `${JSON.stringify(status, null, 2)}\n`,
  );
}

async function startApp(): Promise<void> {
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

async function getBackup() {
  return fetch(`${baseUrl}/api/backup`);
}

async function putBackup(body: unknown) {
  return fetch(`${baseUrl}/api/backup`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  if (storeRoot) {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

const REMOTE = "git@github.com:me/tracker-backup.git";

describe("GET /api/backup", () => {
  it("derives unconfigured when no remote is set", async () => {
    setupStore();
    await startApp();

    const res = await getBackup();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      config: { remote: null, enabled: false },
      status: { state: "unconfigured", lastSuccessAt: null, error: null },
    });
  });

  it("derives stale when last success is older than the threshold", async () => {
    setupStore();
    writeConfig({ remote: REMOTE, enabled: true });
    writeStatus({
      lastSuccessAt: new Date(
        Date.now() - BACKUP_STALE_AFTER_MS - 60_000,
      ).toISOString(),
      state: "idle",
      error: null,
    });
    await startApp();

    const res = await getBackup();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toEqual({ remote: REMOTE, enabled: true });
    expect(body.status.state).toBe("stale");
    expect(body.status.error).toBeNull();
  });

  it("derives retrying from the engine record", async () => {
    setupStore();
    writeConfig({ remote: REMOTE, enabled: true });
    writeStatus({
      lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
      state: "retrying",
      error: "Could not resolve hostname",
    });
    await startApp();

    const res = await getBackup();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.state).toBe("retrying");
    expect(body.status.error).toBe("Could not resolve hostname");
  });

  it("derives diverged from the engine record", async () => {
    setupStore();
    writeConfig({ remote: REMOTE, enabled: true });
    writeStatus({
      lastSuccessAt: new Date(Date.now() - 60_000).toISOString(),
      state: "diverged",
      error: "Remote store identity differs from this machine",
    });
    await startApp();

    const res = await getBackup();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status.state).toBe("diverged");
    expect(body.status.error).toBe(
      "Remote store identity differs from this machine",
    );
  });

  it("derives healthy when a configured mirror is current", async () => {
    const lastSuccessAt = new Date(Date.now() - 60_000).toISOString();
    setupStore();
    writeConfig({ remote: REMOTE, enabled: true });
    writeStatus({ lastSuccessAt, state: "idle", error: null });
    await startApp();

    const res = await getBackup();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      config: { remote: REMOTE, enabled: true },
      status: { state: "healthy", lastSuccessAt, error: null },
    });
  });
});

describe("PUT /api/backup", () => {
  it("persists settings and returns the GET shape", async () => {
    const lastSuccessAt = new Date(Date.now() - 60_000).toISOString();
    setupStore();
    writeStatus({ lastSuccessAt, state: "idle", error: null });
    await startApp();

    const settings = { remote: REMOTE, enabled: true };
    const put = await putBackup(settings);
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody).toEqual({
      config: settings,
      status: { state: "healthy", lastSuccessAt, error: null },
    });

    const onDisk = JSON.parse(
      readFileSync(join(storeRoot, "app-config.json"), "utf8"),
    );
    expect(onDisk.backup).toEqual(settings);

    const get = await getBackup();
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(putBody);
  });

  it("rejects a malformed body", async () => {
    setupStore();
    await startApp();

    const res = await putBackup({ remote: 1, enabled: "yes" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "validation",
    });
    expect(existsSync(join(storeRoot, "app-config.json"))).toBe(false);
  });

  it("rejects a body carrying status fields", async () => {
    setupStore();
    await startApp();

    const res = await putBackup({
      remote: REMOTE,
      enabled: true,
      status: {
        state: "healthy",
        lastSuccessAt: "2026-08-30T19:04:11.000Z",
        error: null,
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      code: "validation",
    });
    expect(existsSync(join(storeRoot, "app-config.json"))).toBe(false);
  });
});

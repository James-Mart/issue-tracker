import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AgentSessions } from "../services/agent-sessions.js";

let root: string;
let server: Server | undefined;
let upstreams: HttpServer[] = [];
const strays: ChildProcess[] = [];

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

function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}

function spawnSleeper(): number {
  const child = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
  strays.push(child);
  return child.pid!;
}

function writeConversationMeta(conversationsDir: string, conversationId: string): void {
  const dir = join(conversationsDir, conversationId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      id: conversationId,
      title: conversationId,
      projectId: "test-project",
      model: "composer-2.5",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
    }),
  );
}

async function listenUpstream(marker: string): Promise<{
  port: number;
  seen: string[];
}> {
  const seen: string[] = [];
  const upstream = createServer((req, res) => {
    seen.push(req.url ?? "");
    res.setHeader("Content-Type", "text/plain");
    res.end(marker);
  });
  upstream.on("upgrade", (req, socket) => {
    seen.push(req.url ?? "");
    socket.end(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
  });
  await new Promise<void>((resolve) => {
    upstream.listen(0, "127.0.0.1", () => resolve());
  });
  upstreams.push(upstream);
  const addr = upstream.address() as AddressInfo;
  return { port: addr.port, seen };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockups-"));
  mkdirSync(join(root, "issues"), { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", join(root, "issues"));
});

afterEach(async () => {
  for (const child of strays) {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already reaped.
      }
    }
  }
  strays.length = 0;
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    server = undefined;
  }
  await Promise.all(
    upstreams.map(
      (upstream) =>
        new Promise<void>((resolve, reject) => {
          upstream.close((err) => (err ? reject(err) : resolve()));
        }),
    ),
  );
  upstreams = [];
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function startApp(): Promise<string> {
  const { createApp } = await import("../app.js");
  const { attachMockupStackProxy } = await import("./mockups.js");
  const app = createApp(stubSessions());
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  attachMockupStackProxy(server!);
  const addr = server!.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

describe("GET /mockups/:conversationId/", () => {
  it("proxies only that conversation's loopback stack and preserves the query", async () => {
    const alpha = await listenUpstream("alpha-storybook");
    const beta = await listenUpstream("beta-storybook");
    const { conversationsDir } = await import("../config.js");
    const { writeMockupStackState } = await import("../services/mockup-scratch.js");
    writeConversationMeta(conversationsDir, "conv-a");
    writeConversationMeta(conversationsDir, "conv-b");
    const pidA = spawnSleeper();
    const pidB = spawnSleeper();
    writeMockupStackState("conv-a", {
      port: alpha.port,
      pid: pidA,
      startTime: procStartTime(pidA),
      baseUrl: `http://127.0.0.1:${alpha.port}`,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    writeMockupStackState("conv-b", {
      port: beta.port,
      pid: pidB,
      startTime: procStartTime(pidB),
      baseUrl: `http://127.0.0.1:${beta.port}`,
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const baseUrl = await startApp();
    const query = "path=/story/button--primary&nav=1";
    const live = await fetch(`${baseUrl}/mockups/conv-a/?${query}`);
    expect(live.status).toBe(200);
    expect(await live.text()).toBe("alpha-storybook");
    expect(alpha.seen).toContain(`/?${query}`);
    expect(beta.seen).toEqual([]);

    const other = await fetch(`${baseUrl}/mockups/conv-b/`);
    expect(other.status).toBe(200);
    expect(await other.text()).toBe("beta-storybook");
    expect(beta.seen).toEqual(["/"]);
    expect(alpha.seen).not.toContain("/");

    const missing = await fetch(`${baseUrl}/mockups/conv-missing/`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("");
    expect(alpha.seen).not.toContain("/");
    expect(beta.seen).toEqual(["/"]);
  });

  it("returns an empty 404 when the recorded stack is not live", async () => {
    const alpha = await listenUpstream("alpha-storybook");
    const { conversationsDir } = await import("../config.js");
    const { writeMockupStackState } = await import("../services/mockup-scratch.js");
    writeConversationMeta(conversationsDir, "conv-a");
    writeMockupStackState("conv-a", {
      port: alpha.port,
      pid: 2 ** 30,
      startTime: "1",
      baseUrl: `http://127.0.0.1:${alpha.port}`,
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const baseUrl = await startApp();
    const res = await fetch(`${baseUrl}/mockups/conv-a/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(alpha.seen).toEqual([]);
  });

  it("upgrades a websocket on the conversation prefix and not on another id", async () => {
    const alpha = await listenUpstream("alpha-storybook");
    const beta = await listenUpstream("beta-storybook");
    const { conversationsDir } = await import("../config.js");
    const { writeMockupStackState } = await import("../services/mockup-scratch.js");
    writeConversationMeta(conversationsDir, "conv-a");
    writeConversationMeta(conversationsDir, "conv-b");
    const pidA = spawnSleeper();
    const pidB = spawnSleeper();
    writeMockupStackState("conv-a", {
      port: alpha.port,
      pid: pidA,
      startTime: procStartTime(pidA),
      baseUrl: `http://127.0.0.1:${alpha.port}`,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    writeMockupStackState("conv-b", {
      port: beta.port,
      pid: pidB,
      startTime: procStartTime(pidB),
      baseUrl: `http://127.0.0.1:${beta.port}`,
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const baseUrl = await startApp();
    const wsUrl = baseUrl.replace("http://", "ws://");
    const socket = new WebSocket(`${wsUrl}/mockups/conv-a/?nav=1`);
    await new Promise<void>((resolve) => {
      socket.once("error", () => resolve());
      socket.once("open", () => resolve());
      socket.once("unexpected-response", () => resolve());
    });
    socket.close();
    expect(alpha.seen).toContain("/mockups/conv-a/?nav=1");
    expect(beta.seen).toEqual([]);

    const missing = await fetch(`${wsUrl.replace("ws://", "http://")}/mockups/conv-gone/`);
    expect(missing.status).toBe(404);
    expect(beta.seen).toEqual([]);
  });
});

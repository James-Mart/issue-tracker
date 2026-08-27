import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let issuesDir: string;
const strays: ChildProcess[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-stack-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  for (const child of strays) {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already reaped by the test.
      }
    }
  }
  strays.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

async function loadService() {
  return import("./mockup-stack.js");
}

async function loadScratch() {
  return import("./mockup-scratch.js");
}

async function loadConfig() {
  return import("../config.js");
}

function writeConversationMeta(
  conversationsDir: string,
  conversationId: string,
  overrides: { agentId?: string } = {},
): void {
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
      ...overrides,
    }),
  );
}

function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}

function spawnSleeper(): number {
  const child = spawn("sleep", ["300"], {
    detached: true,
    stdio: "ignore",
  });
  strays.push(child);
  return child.pid!;
}

function isAlive(pid: number): boolean {
  if (!existsSync(`/proc/${pid}/stat`)) return false;
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
}

describe("mockup stack liveness", () => {
  it("pins a recorded pid to the process that was started", async () => {
    const { isMockupStackLive } = await loadService();
    const pid = spawnSleeper();

    expect(
      isMockupStackLive({
        port: 41005,
        pid,
        startTime: procStartTime(pid),
        baseUrl: "http://127.0.0.1:41005",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    // Same pid, different process: what a recycled pid in stale state looks like.
    expect(
      isMockupStackLive({
        port: 41005,
        pid,
        startTime: "1",
        baseUrl: "http://127.0.0.1:41005",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("treats a pid that no longer exists as dead", async () => {
    const { isMockupStackLive } = await loadService();

    expect(
      isMockupStackLive({
        port: 41005,
        pid: 2 ** 30,
        startTime: "1",
        baseUrl: "http://127.0.0.1:41005",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});

async function writeHarnessConfig(conversationId: string): Promise<string> {
  const { conversationsDir } = await loadConfig();
  writeConversationMeta(conversationsDir, conversationId);
  const targetRoot = join(root, "target");
  const reactRoot = join(root, "react-node_modules");
  const cssEntry = join(root, "styles.css");
  const aliasDir = join(root, "alias");
  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(reactRoot, { recursive: true });
  mkdirSync(aliasDir, { recursive: true });
  writeFileSync(cssEntry, "body {}", "utf8");

  const config = {
    targetRoot,
    reactRoot,
    cssEntries: [cssEntry],
    aliases: { "@target": aliasDir },
    storiesGlobs: [join(root, "stories", "**", "*.stories.tsx")],
  };

  const { harnessConfigPath } = await loadScratch();
  const path = harnessConfigPath(conversationId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(config), "utf8");
  return path;
}

describe("mockup stack durable state", () => {
  it("stores state and log beside each other under mockup-stack/", async () => {
    const { mockupStackLogPath, mockupStackStatePath } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    const statePath = mockupStackStatePath("my-conversation");
    const logPath = mockupStackLogPath("my-conversation");

    expect(statePath).toBe(
      join(
        conversationsDir,
        "my-conversation",
        "mockups",
        "mockup-stack",
        "state.json",
      ),
    );
    expect(logPath).toBe(
      join(
        conversationsDir,
        "my-conversation",
        "mockups",
        "mockup-stack",
        "storybook.log",
      ),
    );
  });
});

describe("mockup stack lifecycle", () => {
  it("reuses a live recorded stack instead of spawning again", async () => {
    const { isMockupStackLive, startMockupStack, stopMockupStack } =
      await loadService();
    const {
      mockupStackStatePath,
      readMockupStackState,
      writeMockupStackState,
    } = await loadScratch();
    await writeHarnessConfig("my-conversation");

    const pid = spawnSleeper();
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid,
      startTime: procStartTime(pid),
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const handle = await startMockupStack("my-conversation");

    expect(handle.reused).toBe(true);
    expect(handle.state.pid).toBe(pid);
    expect(readMockupStackState("my-conversation")).toEqual(handle.state);
    expect(isMockupStackLive(handle.state)).toBe(true);

    await stopMockupStack("my-conversation");
    expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
  });

  it("stop succeeds quietly when no stack is recorded", async () => {
    const { stopMockupStack } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    await expect(stopMockupStack("my-conversation")).resolves.toEqual({
      stopped: false,
      state: null,
    });
  });

  it("removes state when stopped by the conversation agent id", async () => {
    const { stopMockupStack } = await loadService();
    const { mockupStackStatePath, writeMockupStackState } =
      await loadScratch();
    const { conversationsDir } = await loadConfig();
    const agentId = "agent-45876f25-f1a3-4300-b066-7da0ac7979d5";
    writeConversationMeta(conversationsDir, "my-conversation", { agentId });

    const pid = spawnSleeper();
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid,
      startTime: procStartTime(pid),
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await stopMockupStack(agentId);

    expect(result.stopped).toBe(true);
    expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
    expect(isAlive(pid)).toBe(false);
  });

  it("start fails naming the harness path when configuration is missing", async () => {
    const { startMockupStack } = await loadService();
    const { harnessConfigPath } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    const expected = harnessConfigPath("my-conversation");
    await expect(startMockupStack("my-conversation")).rejects.toThrow(
      `missing mockup harness configuration at ${expected}`,
    );
  });
});

function writeStackStateDirect(
  conversationsDir: string,
  conversationId: string,
  state: {
    port: number;
    pid: number;
    startTime: string;
    baseUrl: string;
    startedAt: string;
  },
): void {
  const statePath = join(
    conversationsDir,
    conversationId,
    "mockups",
    "mockup-stack",
    "state.json",
  );
  mkdirSync(join(statePath, ".."), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe("stopAllMockupStacks", () => {
  it("stops every live recorded stack and reports freed ports", async () => {
    const { stopAllMockupStacks } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "conv-a");
    writeConversationMeta(conversationsDir, "conv-b");

    const pidA = spawnSleeper();
    const pidB = spawnSleeper();
    writeStackStateDirect(conversationsDir, "conv-a", {
      port: 41001,
      pid: pidA,
      startTime: procStartTime(pidA),
      baseUrl: "http://127.0.0.1:41001",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    writeStackStateDirect(conversationsDir, "conv-b", {
      port: 41002,
      pid: pidB,
      startTime: procStartTime(pidB),
      baseUrl: "http://127.0.0.1:41002",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    // Dead stack with stale state — cleaned but not reported as freed.
    writeStackStateDirect(conversationsDir, "conv-dead", {
      port: 41003,
      pid: 2 ** 30,
      startTime: "1",
      baseUrl: "http://127.0.0.1:41003",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const freed = await stopAllMockupStacks();

    expect(freed).toEqual([
      { conversationId: "conv-a", port: 41001 },
      { conversationId: "conv-b", port: 41002 },
    ]);
    expect(isAlive(pidA)).toBe(false);
    expect(isAlive(pidB)).toBe(false);
    expect(
      existsSync(
        join(
          conversationsDir,
          "conv-a",
          "mockups",
          "mockup-stack",
          "state.json",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(
          conversationsDir,
          "conv-dead",
          "mockups",
          "mockup-stack",
          "state.json",
        ),
      ),
    ).toBe(false);
  });
});

describe("reapOrphanedMockupStacksAtBoot", () => {
  it("removes stale state for a dead pid without signaling", async () => {
    const { reapOrphanedMockupStacksAtBoot } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "gone-conversation");
    writeStackStateDirect(conversationsDir, "gone-conversation", {
      port: 41005,
      pid: 2 ** 30,
      startTime: "1",
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const report = await reapOrphanedMockupStacksAtBoot();

    expect(report.staleStateRemoved).toEqual(["gone-conversation"]);
    expect(report.orphanedStacksStopped).toEqual([]);
    expect(
      existsSync(
        join(
          conversationsDir,
          "gone-conversation",
          "mockups",
          "mockup-stack",
          "state.json",
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(join(conversationsDir, "gone-conversation", "mockups")),
    ).toBe(true);
  });

  it("removes stale state when a pid was recycled with a different start time", async () => {
    const { reapOrphanedMockupStacksAtBoot } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    const pid = spawnSleeper();
    writeStackStateDirect(conversationsDir, "my-conversation", {
      port: 41005,
      pid,
      startTime: "1",
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const report = await reapOrphanedMockupStacksAtBoot();

    expect(report.staleStateRemoved).toEqual(["my-conversation"]);
    expect(report.orphanedStacksStopped).toEqual([]);
    expect(isAlive(pid)).toBe(true);
    expect(
      existsSync(join(conversationsDir, "my-conversation", "mockups")),
    ).toBe(true);
  });

  it("stops a live stack and removes scratch when the conversation is gone", async () => {
    const { reapOrphanedMockupStacksAtBoot } = await loadService();
    const { conversationsDir } = await loadConfig();
    const conversationId = "orphaned-conversation";
    const pid = spawnSleeper();
    const scratch = join(conversationsDir, conversationId, "mockups");
    mkdirSync(join(scratch, "direction-a"), { recursive: true });
    writeStackStateDirect(conversationsDir, conversationId, {
      port: 41006,
      pid,
      startTime: procStartTime(pid),
      baseUrl: "http://127.0.0.1:41006",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const report = await reapOrphanedMockupStacksAtBoot();

    expect(report.staleStateRemoved).toEqual([]);
    expect(report.orphanedStacksStopped).toEqual([
      { conversationId, port: 41006 },
    ]);
    expect(isAlive(pid)).toBe(false);
    expect(existsSync(scratch)).toBe(false);
  });

  it("leaves a live stack and scratch when the conversation still exists", async () => {
    const { isMockupStackLive, reapOrphanedMockupStacksAtBoot } =
      await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "active-conversation");
    const pid = spawnSleeper();
    const state = {
      port: 41007,
      pid,
      startTime: procStartTime(pid),
      baseUrl: "http://127.0.0.1:41007",
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    writeStackStateDirect(conversationsDir, "active-conversation", state);
    const scratch = join(conversationsDir, "active-conversation", "mockups");
    mkdirSync(join(scratch, "direction-a"), { recursive: true });

    const report = await reapOrphanedMockupStacksAtBoot();

    expect(report.staleStateRemoved).toEqual([]);
    expect(report.orphanedStacksStopped).toEqual([]);
    expect(isMockupStackLive(state)).toBe(true);
    expect(existsSync(scratch)).toBe(true);
    expect(
      existsSync(
        join(scratch, "mockup-stack", "state.json"),
      ),
    ).toBe(true);
  });
});

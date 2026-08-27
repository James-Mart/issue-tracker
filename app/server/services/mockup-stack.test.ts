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

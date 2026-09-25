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
import type { ChildProcess } from "node:child_process";

const spawnDelegate = vi.hoisted(() => ({
  actual: null as typeof import("node:child_process") | null,
  impl: null as
    | ((
        command: string,
        args: readonly string[],
        options: import("node:child_process").SpawnOptions | undefined,
      ) => ChildProcess)
    | null,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  spawnDelegate.actual = actual;
  return {
    ...actual,
    spawn: (
      command: string,
      args: readonly string[],
      options: import("node:child_process").SpawnOptions | undefined,
    ) =>
      spawnDelegate.impl
        ? spawnDelegate.impl(command, args, options)
        : actual.spawn(command, args, options ?? {}),
  };
});

function realSpawn(
  command: string,
  args: readonly string[],
  options?: import("node:child_process").SpawnOptions,
): ChildProcess {
  return spawnDelegate.actual!.spawn(command, args, options ?? {});
}

import { spawn } from "node:child_process";

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
  spawnDelegate.impl = null;
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

function stubReadyFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200 }) as Response),
  );
}

function spawnMockupStorybookSleeper(
  command: string,
  args: readonly string[],
  options: import("node:child_process").SpawnOptions | undefined,
): ChildProcess {
  if (command === "sh" && args[1]?.includes("oom_score_adj")) {
    const patched = [...args];
    patched[3] = "sleep";
    patched.length = 4;
    patched.push("300");
    const child = realSpawn(command, patched, {
      ...(options ?? {}),
      detached: true,
      stdio: "ignore",
    });
    strays.push(child);
    return child;
  }
  const child = realSpawn(command, args, options ?? {});
  if (options?.detached) strays.push(child);
  return child;
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

/**
 * A detached sleeper that forks a sleeper of its own, mirroring how Storybook
 * holds children inside the group stop signals.
 */
function spawnGroupLeader(childPidFile: string): number {
  const child = spawn("sh", ["-c", `sleep 300 & echo $! > ${childPidFile}; wait`], {
    detached: true,
    stdio: "ignore",
  });
  strays.push(child);
  return child.pid!;
}

async function waitForFile(path: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    if (existsSync(path)) {
      const body = readFileSync(path, "utf8").trim();
      if (body) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${path}`);
}

/** Collection removes the /proc entry. State Z is still unreaped. */
function isCollected(pid: number): boolean {
  return !existsSync(`/proc/${pid}`);
}

function procInfo(pid: number): { state: string; ppid: number } | null {
  if (!existsSync(`/proc/${pid}/stat`)) return null;
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return { state: fields[0]!, ppid: Number(fields[1]) };
}

async function waitForCollection(pid: number): Promise<boolean> {
  for (let i = 0; i < 100 && !isCollected(pid); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return isCollected(pid);
}

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
    expect(isCollected(pidA)).toBe(true);
    expect(isCollected(pidB)).toBe(true);
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
    expect(isAlive(pid)).toBe(true);
    expect(
      existsSync(join(conversationsDir, "my-conversation", "mockups")),
    ).toBe(true);
  });

  it("lists a live stack whose conversation is gone in staleStateRemoved", async () => {
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
    const kill = vi.spyOn(process, "kill");
    try {
      const report = await reapOrphanedMockupStacksAtBoot();

      expect(report.staleStateRemoved).toEqual([conversationId]);
      expect(
        kill.mock.calls.some((call) => Math.abs(Number(call[0])) === pid),
      ).toBe(false);
    } finally {
      kill.mockRestore();
    }
    expect(isAlive(pid)).toBe(true);
    expect(existsSync(join(scratch, "direction-a"))).toBe(true);
    expect(
      existsSync(join(scratch, "mockup-stack", "state.json")),
    ).toBe(false);
  });

  it("removes a live recorded pid this process does not own and does not signal it", async () => {
    const { reapOrphanedMockupStacksAtBoot } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "foreign-conversation");
    const pidFile = join(root, "foreign.pid");
    const holder = spawn(
      "sh",
      ["-c", `sleep 300 & echo $! > ${pidFile}; wait`],
      { detached: true, stdio: "ignore" },
    );
    strays.push(holder);
    const childPid = Number(await waitForFile(pidFile));
    writeStackStateDirect(conversationsDir, "foreign-conversation", {
      port: 41008,
      pid: childPid,
      startTime: procStartTime(childPid),
      baseUrl: "http://127.0.0.1:41008",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const kill = vi.spyOn(process, "kill");
    try {
      const report = await reapOrphanedMockupStacksAtBoot();
      expect(report.staleStateRemoved).toEqual(["foreign-conversation"]);
      expect(
        kill.mock.calls.some((call) => Math.abs(Number(call[0])) === childPid),
      ).toBe(false);
    } finally {
      kill.mockRestore();
    }
    expect(
      existsSync(
        join(
          conversationsDir,
          "foreign-conversation",
          "mockups",
          "mockup-stack",
          "state.json",
        ),
      ),
    ).toBe(false);
    expect(procInfo(childPid)?.ppid).not.toBe(process.pid);
    expect(procInfo(childPid)?.state).not.toBe("Z");
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
    expect(isMockupStackLive(state)).toBe(true);
    expect(existsSync(scratch)).toBe(true);
    expect(
      existsSync(
        join(scratch, "mockup-stack", "state.json"),
      ),
    ).toBe(true);
  });
});

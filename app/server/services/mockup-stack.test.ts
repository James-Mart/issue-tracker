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
/** Detached group leaders whose parent is not this process. */
const foreignLeaders: number[] = [];

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
  for (const pid of foreignLeaders) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already reaped by the test.
    }
  }
  foreignLeaders.length = 0;
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

function procInfo(
  pid: number,
): { state: string; ppid: number; pgrp: number } | null {
  if (!existsSync(`/proc/${pid}/stat`)) return null;
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return {
    state: fields[0]!,
    ppid: Number(fields[1]),
    pgrp: Number(fields[2]),
  };
}

/**
 * A detached process-group leader whose parent is another process. The parent
 * reaps it, so a stop that signals the group can observe it leave `/proc`.
 */
async function spawnForeignGroupLeader(pidFile: string): Promise<number> {
  const holder = spawn(
    "python3",
    [
      "-c",
      `import os, time
pid = os.fork()
if pid == 0:
    os.setsid()
    open(${JSON.stringify(pidFile)}, "w").write(str(os.getpid()))
    time.sleep(300)
    os._exit(0)
else:
    os.wait()
    time.sleep(1)
`,
    ],
    { detached: true, stdio: "ignore" },
  );
  strays.push(holder);
  const leader = Number(await waitForFile(pidFile));
  foreignLeaders.push(leader);
  return leader;
}

async function waitForCollection(pid: number): Promise<boolean> {
  for (let i = 0; i < 100 && !isCollected(pid); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return isCollected(pid);
}

describe("storybook dev command", () => {
  it("binds loopback and records the public mockup prefix", async () => {
    const { mockupStorybookBase, storybookDevArgs } = await loadService();
    expect(storybookDevArgs(41005)).toEqual([
      "dev",
      "-c",
      ".storybook",
      "--no-open",
      "--ci",
      "--host",
      "127.0.0.1",
      "--port",
      "41005",
    ]);
    expect(mockupStorybookBase("my-conversation")).toBe(
      "/mockups/my-conversation/",
    );
  });
});

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
    const { readSessionOutcome, sessionOutcomePath } = await loadScratch();
    expect(readSessionOutcome("my-conversation")).toBe("open");

    await stopMockupStack("my-conversation");
    expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
    expect(existsSync(sessionOutcomePath("my-conversation"))).toBe(true);
    expect(readSessionOutcome("my-conversation")).toBe("open");
  });

  it("records ended before stop and leaves the outcome file in place", async () => {
    const { stopMockupStack } = await loadService();
    const {
      mockupStackStatePath,
      readSessionOutcome,
      sessionOutcomePath,
      writeMockupStackState,
      writeSessionOutcome,
    } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    writeSessionOutcome("my-conversation", "open");
    const pid = spawnSleeper();
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid,
      startTime: procStartTime(pid),
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await stopMockupStack("my-conversation", { ended: true });

    expect(result.stopped).toBe(true);
    expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
    expect(existsSync(sessionOutcomePath("my-conversation"))).toBe(true);
    expect(readSessionOutcome("my-conversation")).toBe("ended");
    expect(isCollected(pid)).toBe(true);
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
    expect(isCollected(pid)).toBe(true);
  });

  it("collects the process group before stop resolves", async () => {
    const { stopMockupStack } = await loadService();
    const { mockupStackStatePath, writeMockupStackState } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    const childPidFile = join(root, "child.pid");
    const leaderPid = spawnGroupLeader(childPidFile);
    const forkedPid = Number(await waitForFile(childPidFile));
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid: leaderPid,
      startTime: procStartTime(leaderPid),
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await stopMockupStack("my-conversation");

    expect(result.stopped).toBe(true);
    expect(isCollected(leaderPid)).toBe(true);
    expect(await waitForCollection(forkedPid)).toBe(true);
    expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
  });

  it("drops a recorded pid owned by another process without signaling it", async () => {
    const { stopMockupStack } = await loadService();
    const { mockupStackStatePath, writeMockupStackState } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    const pidFile = join(root, "held.pid");
    const holder = spawn(
      "sh",
      ["-c", `sleep 300 & echo $! > ${pidFile}; wait`],
      { detached: true, stdio: "ignore" },
    );
    strays.push(holder);
    const childPid = Number(await waitForFile(pidFile));
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid: childPid,
      startTime: procStartTime(childPid),
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const before = procInfo(childPid);
    const kill = vi.spyOn(process, "kill");
    try {
      const result = await stopMockupStack("my-conversation");
      expect(result.stopped).toBe(true);
      expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
      expect(
        kill.mock.calls.some((call) => Math.abs(Number(call[0])) === childPid),
      ).toBe(false);
    } finally {
      kill.mockRestore();
    }
    const after = procInfo(childPid);
    expect(after?.ppid).toBe(before?.ppid);
    expect(after?.ppid).not.toBe(process.pid);
    expect(after?.state).not.toBe("Z");
  });

  it("signals a live group leader whose parent is not this process", async () => {
    const { stopMockupStack } = await loadService();
    const { mockupStackStatePath, writeMockupStackState } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    const leader = await spawnForeignGroupLeader(join(root, "stop-foreign.pid"));
    expect(procInfo(leader)?.ppid).not.toBe(process.pid);
    expect(procInfo(leader)?.pgrp).toBe(leader);
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid: leader,
      startTime: procStartTime(leader),
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await stopMockupStack("my-conversation");

    expect(result.stopped).toBe(true);
    expect(isCollected(leader)).toBe(true);
    expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
  });

  it("does not signal a recycled pid whose start time differs", async () => {
    const { stopMockupStack } = await loadService();
    const { mockupStackStatePath, writeMockupStackState } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    const pid = spawnSleeper();
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid,
      startTime: "1",
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const kill = vi.spyOn(process, "kill");
    try {
      const result = await stopMockupStack("my-conversation");
      expect(result.stopped).toBe(true);
      expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
      expect(
        kill.mock.calls.some((call) => Math.abs(Number(call[0])) === pid),
      ).toBe(false);
    } finally {
      kill.mockRestore();
    }
    expect(isAlive(pid)).toBe(true);
  });

  it(
    "rejects only after waitpid collects a group still uncollected past KILL_GRACE",
    async () => {
      const { stopMockupStack } = await loadService();
      const { writeMockupStackState } = await loadScratch();
      const { conversationsDir } = await loadConfig();
      writeConversationMeta(conversationsDir, "my-conversation");
      const child = spawn("sh", ["-c", "trap '' TERM; sleep 300"], {
        detached: true,
        stdio: "ignore",
      });
      strays.push(child);
      const pid = child.pid!;
      writeMockupStackState("my-conversation", {
        port: 41005,
        pid,
        startTime: procStartTime(pid),
        baseUrl: "http://127.0.0.1:41005",
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      const realKill = process.kill.bind(process);
      let deliver = false;
      const spy = vi.spyOn(process, "kill").mockImplementation(((
        target: number,
        signal?: NodeJS.Signals | number,
      ) => {
        if (!deliver && (signal === "SIGTERM" || signal === "SIGKILL")) {
          return true;
        }
        return realKill(target, signal as NodeJS.Signals);
      }) as typeof process.kill);
      try {
        let settled = false;
        const outcome = stopMockupStack("my-conversation").then(
          () => {
            settled = true;
            return "resolved" as const;
          },
          (err: Error) => {
            settled = true;
            return err;
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 12_000));
        expect(settled).toBe(false);
        expect(existsSync(`/proc/${pid}`)).toBe(true);
        deliver = true;
        realKill(-pid, "SIGKILL");
        const result = await outcome;
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toMatch(/survived SIGKILL/);
        expect(isCollected(pid)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
    20_000,
  );

  it("installs the child reaper before spawn", async () => {
    const reaperCalls: string[] = [];
    vi.doMock("./child-reaper.js", () => ({
      ensureChildReaper: () => {
        reaperCalls.push("ensure");
      },
      reapExitedChildren: () => {},
    }));
    vi.resetModules();
    try {
      const { conversationsDir } = await import("../config.js");
      writeConversationMeta(conversationsDir, "my-conversation");
      const { startMockupStack } = await import("./mockup-stack.js");
      await expect(startMockupStack("my-conversation")).rejects.toThrow(
        /missing mockup harness configuration/,
      );
      expect(reaperCalls).toEqual(["ensure"]);
    } finally {
      vi.doUnmock("./child-reaper.js");
      vi.resetModules();
    }
  });

  it("collects a detached child that exits while this process stays up", async () => {
    const { startMockupStack } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    await expect(startMockupStack("my-conversation")).rejects.toThrow(
      /missing mockup harness configuration/,
    );

    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    strays.push(child);
    child.unref();
    const info = procInfo(child.pid!);
    expect(info?.ppid).toBe(process.pid);
    expect(info?.state).not.toBe("Z");
    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });
    process.kill(child.pid!, "SIGTERM");
    expect(await exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(await waitForCollection(child.pid!)).toBe(true);
  });

  it("collects a grandchild whose parent has exited instead of leaving it for pid 1", async () => {
    const { startMockupStack } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    await expect(startMockupStack("my-conversation")).rejects.toThrow(
      /missing mockup harness configuration/,
    );

    const pidFile = join(root, "grandchild.pid");
    const parent = spawn(
      "python3",
      [
        "-c",
        `import os, time
pid = os.fork()
if pid == 0:
    open(${JSON.stringify(pidFile)}, "w").write(str(os.getpid()))
    time.sleep(0.3)
    os._exit(0)
else:
    os._exit(0)
`,
      ],
      { detached: true, stdio: "ignore" },
    );
    strays.push(parent);
    parent.unref();
    const grandchild = Number(await waitForFile(pidFile));
    const info = procInfo(grandchild);
    expect(info?.ppid).toBe(process.pid);
    expect(info?.state).not.toBe("Z");
    expect(await waitForCollection(grandchild)).toBe(true);
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

  it("stops a live group leader whose parent is not this process", async () => {
    const { stopAllMockupStacks } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "cli-conversation");
    const leader = await spawnForeignGroupLeader(join(root, "stop-all-foreign.pid"));
    writeStackStateDirect(conversationsDir, "cli-conversation", {
      port: 41009,
      pid: leader,
      startTime: procStartTime(leader),
      baseUrl: "http://127.0.0.1:41009",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const freed = await stopAllMockupStacks();

    expect(freed).toEqual([{ conversationId: "cli-conversation", port: 41009 }]);
    expect(isCollected(leader)).toBe(true);
    expect(
      existsSync(
        join(
          conversationsDir,
          "cli-conversation",
          "mockups",
          "mockup-stack",
          "state.json",
        ),
      ),
    ).toBe(false);
  });
});

describe("stopSpawnedMockupStacksOnShutdown", () => {
  it("stops stacks this process spawned and leaves a CLI-started stack running with its state", async () => {
    const { stopSpawnedMockupStacksOnShutdown } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "spawned-conversation");
    writeConversationMeta(conversationsDir, "cli-conversation");
    const spawned = spawnSleeper();
    const leader = await spawnForeignGroupLeader(join(root, "shutdown-foreign.pid"));
    writeStackStateDirect(conversationsDir, "spawned-conversation", {
      port: 41011,
      pid: spawned,
      startTime: procStartTime(spawned),
      baseUrl: "http://127.0.0.1:41011",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const cliState = {
      port: 41012,
      pid: leader,
      startTime: procStartTime(leader),
      baseUrl: "http://127.0.0.1:41012",
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    writeStackStateDirect(conversationsDir, "cli-conversation", cliState);
    const cliStatePath = join(
      conversationsDir,
      "cli-conversation",
      "mockups",
      "mockup-stack",
      "state.json",
    );
    const before = readFileSync(cliStatePath, "utf8");
    expect(procInfo(leader)?.ppid).not.toBe(process.pid);

    const freed = await stopSpawnedMockupStacksOnShutdown();

    expect(freed).toEqual([
      { conversationId: "spawned-conversation", port: 41011 },
    ]);
    expect(isCollected(spawned)).toBe(true);
    expect(isAlive(leader)).toBe(true);
    expect(readFileSync(cliStatePath, "utf8")).toBe(before);
    expect(
      existsSync(
        join(
          conversationsDir,
          "spawned-conversation",
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

  it("keeps a live stack whose parent is not this process, state intact, and does not signal it", async () => {
    const { reapOrphanedMockupStacksAtBoot } = await loadService();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "foreign-conversation");
    const pidFile = join(root, "foreign.pid");
    const leader = await spawnForeignGroupLeader(pidFile);
    const statePath = join(
      conversationsDir,
      "foreign-conversation",
      "mockups",
      "mockup-stack",
      "state.json",
    );
    writeStackStateDirect(conversationsDir, "foreign-conversation", {
      port: 41008,
      pid: leader,
      startTime: procStartTime(leader),
      baseUrl: "http://127.0.0.1:41008",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    const before = readFileSync(statePath, "utf8");
    expect(procInfo(leader)?.ppid).not.toBe(process.pid);
    expect(procInfo(leader)?.pgrp).toBe(leader);
    const kill = vi.spyOn(process, "kill");
    try {
      const report = await reapOrphanedMockupStacksAtBoot();
      expect(report.staleStateRemoved).toEqual([]);
      expect(
        kill.mock.calls.some((call) => Math.abs(Number(call[0])) === leader),
      ).toBe(false);
    } finally {
      kill.mockRestore();
    }
    expect(readFileSync(statePath, "utf8")).toBe(before);
    expect(procInfo(leader)?.ppid).not.toBe(process.pid);
    expect(procInfo(leader)?.state).not.toBe("Z");
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

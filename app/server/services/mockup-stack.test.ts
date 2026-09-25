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

const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";

function writeHeapLimitReport(heapReportsDir: string, pid: number): void {
  mkdirSync(heapReportsDir, { recursive: true });
  writeFileSync(
    join(heapReportsDir, `report.${pid}.127.0.0.1.${Date.now()}.json`),
    JSON.stringify({ header: { event: HEAP_OOM_EVENT, processId: pid } }),
  );
}

describe("mockup stack heap limit reporting", () => {
  it("start on a dead recorded stack prints the memory-limit line and restarts", async () => {
    stubReadyFetch();
    spawnDelegate.impl = spawnMockupStorybookSleeper;
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    await writeHarnessConfig("my-conversation");
    const { startMockupStack, mockupStackMemoryLimitMessage, stopMockupStack } =
      await loadService();
    const { mockupStackDir, writeMockupStackState } = await loadScratch();

    const deadPid = 2 ** 30;
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid: deadPid,
      startTime: "1",
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    writeHeapLimitReport(join(mockupStackDir("my-conversation"), "heap-reports"), deadPid);

    const handle = await startMockupStack("my-conversation");

    expect(stderr).toHaveBeenCalledWith(mockupStackMemoryLimitMessage());
    expect(handle.reused).toBe(false);
    expect(handle.state.pid).not.toBe(deadPid);

    await stopMockupStack("my-conversation");
  });

  it("stop prints the memory-limit line when a heap report matches the recorded pid", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const { stopMockupStack, mockupStackMemoryLimitMessage } = await loadService();
    const { mockupStackDir, writeMockupStackState } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    const deadPid = 2 ** 30;
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid: deadPid,
      startTime: "1",
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    writeHeapLimitReport(join(mockupStackDir("my-conversation"), "heap-reports"), deadPid);

    await stopMockupStack("my-conversation");

    expect(stderr).toHaveBeenCalledWith(mockupStackMemoryLimitMessage());
  });

  it("does not print when the heap report is for a different pid", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const { stopMockupStack } = await loadService();
    const { mockupStackDir, writeMockupStackState } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");

    const deadPid = 2 ** 30;
    writeMockupStackState("my-conversation", {
      port: 41005,
      pid: deadPid,
      startTime: "1",
      baseUrl: "http://127.0.0.1:41005",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    writeHeapLimitReport(
      join(mockupStackDir("my-conversation"), "heap-reports"),
      deadPid + 1,
    );

    await stopMockupStack("my-conversation");

    expect(stderr).not.toHaveBeenCalled();
  });
});

describe("mockup stack memory hardening", () => {
  it("appends heap limit NODE_OPTIONS when spawning storybook", async () => {
    stubReadyFetch();
    vi.stubEnv("NODE_OPTIONS", "--enable-source-maps");
    let capturedEnv: NodeJS.ProcessEnv | undefined;

    spawnDelegate.impl = (command, _args, options) => {
      capturedEnv = { ...(options?.env as NodeJS.ProcessEnv) };
      const child = realSpawn("sh", ["-c", "sleep 300"], {
        ...(options ?? {}),
        detached: true,
        stdio: "ignore",
      });
      strays.push(child);
      return child;
    };

    await writeHarnessConfig("my-conversation");
    const { startMockupStack, stopMockupStack } = await loadService();
    const { mockupStackDir } = await loadScratch();
    const heapReports = join(mockupStackDir("my-conversation"), "heap-reports");

    await startMockupStack("my-conversation");

    expect(capturedEnv?.NODE_OPTIONS).toContain("--enable-source-maps");
    expect(capturedEnv?.NODE_OPTIONS).toContain("--max-old-space-size=2048");
    expect(capturedEnv?.NODE_OPTIONS).toContain("--report-on-fatalerror");
    expect(capturedEnv?.NODE_OPTIONS).toContain(
      `--report-directory=${heapReports}`,
    );

    await stopMockupStack("my-conversation");
  });

  it.skipIf(process.platform !== "linux")(
    "sets oom_score_adj to 1000 on the storybook process",
    async () => {
      stubReadyFetch();
      const serverOomBefore = readFileSync(
        "/proc/self/oom_score_adj",
        "utf8",
      ).trim();

      spawnDelegate.impl = spawnMockupStorybookSleeper;

      await writeHarnessConfig("my-conversation");
      const { startMockupStack, stopMockupStack } = await loadService();

      const handle = await startMockupStack("my-conversation");

      expect(
        readFileSync(`/proc/${handle.state.pid}/oom_score_adj`, "utf8").trim(),
      ).toBe("1000");
      expect(readFileSync("/proc/self/oom_score_adj", "utf8").trim()).toBe(
        serverOomBefore,
      );

      await stopMockupStack("my-conversation");
    },
  );
});

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

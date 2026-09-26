import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
let workspace: string;
let workspaceB: string;
const strays: ChildProcess[] = [];

const STAMP = "2026-01-01T00:00:00.000Z";

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({
      id,
      title: id,
      createdAt: STAMP,
      updatedAt: STAMP,
      ...body,
    }),
  );
}

function seedStories(stories: { id: string; worktreePath: string }[]): void {
  writeIssue("proj", {
    kind: "project",
    title: "Proj",
    runtime: {
      start: "sleep 30",
      baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
    },
  });
  for (const story of stories) {
    writeIssue(story.id, {
      kind: "story",
      partOf: "proj",
      worktreePath: story.worktreePath,
    });
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-agent-stack-"));
  issuesDir = join(root, "issues");
  workspace = join(root, "workspace-a");
  workspaceB = join(root, "workspace-b");
  mkdirSync(issuesDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(workspaceB, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  seedStories([
    { id: "story-a", worktreePath: workspace },
    { id: "story-b", worktreePath: workspaceB },
  ]);
});

afterEach(() => {
  spawnDelegate.impl = null;
  vi.restoreAllMocks();
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
  return import("./agent-stack.js");
}

async function loadConfig() {
  return import("../config.js");
}

/** Independent read of the liveness token the service pins pids with. */
function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}

/**
 * A detached sleeper that forks a sleeper of its own, mirroring how `tsx watch`
 * and Vite each hold children inside the group the service signals.
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

function stackState(
  conversationId: string,
  pid: number,
  worktreePath: string,
  port = 41002,
  auxPort = 41001,
) {
  return {
    conversationId,
    issueId: "story-a",
    worktree: worktreePath,
    port,
    auxPort,
    dataDir: join(root, "data", conversationId),
    baseUrl: `http://127.0.0.1:${port}`,
    startedAt: "2026-01-01T00:00:00.000Z",
    processes: [{ role: "api" as const, pid, startTime: procStartTime(pid) }],
    cursorConversationIds: [],
  };
}

describe("agent stack durable state", () => {
  it("stores state under the conversation, as a peer of agent-state/", async () => {
    const { agentStackStatePath } = await loadService();
    const { conversationsDir } = await loadConfig();

    const path = agentStackStatePath("my-conversation");

    expect(path).toBe(
      join(conversationsDir, "my-conversation", "agent-stack", "state.json"),
    );
    expect(dirname(dirname(path))).toBe(
      dirname(join(conversationsDir, "my-conversation", "agent-state")),
    );
  });

  it("reports no state before a stack has started", async () => {
    const { readAgentStackState } = await loadService();

    expect(readAgentStackState("my-conversation")).toBeNull();
  });

  it("refuses a conversation id that would escape the conversations dir", async () => {
    const { agentStackStatePath } = await loadService();

    expect(() => agentStackStatePath("../../etc")).toThrow(/must be a slug/);
  });

  it("rejects malformed state instead of treating it as no stack", async () => {
    const { agentStackDir, agentStackStatePath, readAgentStackState } =
      await loadService();
    mkdirSync(agentStackDir("my-conversation"), { recursive: true });
    writeFileSync(
      agentStackStatePath("my-conversation"),
      JSON.stringify({ conversationId: "my-conversation", apiPort: "8061" }),
    );

    expect(() => readAgentStackState("my-conversation")).toThrow(
      /invalid agent-stack state/,
    );
  });

  it("exposes the caller-facing env contract by its exact variable names", async () => {
    const { agentStackEnv } = await loadService();

    expect(
      agentStackEnv({
        conversationId: "my-conversation",
        issueId: "story-a",
        worktree: workspace,
        port: 41002,
        auxPort: 41001,
        dataDir: join(root, "data", "my-conversation"),
        baseUrl: "http://127.0.0.1:41002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [],
        cursorConversationIds: [],
      }),
    ).toEqual({
      AGENT_STACK_PORT: "41002",
      AGENT_STACK_AUX_PORT: "41001",
      AGENT_STACK_DATA_DIR: join(root, "data", "my-conversation"),
      AGENT_STACK_BASE_URL: "http://127.0.0.1:41002",
    });
  });
});

describe("agent stack cursor index", () => {
  it("maps cursor conversation id to the app conversation under conversations/", async () => {
    const { agentStackCursorIndexPath } = await loadService();
    const { conversationsDir } = await loadConfig();

    expect(agentStackCursorIndexPath("cursor-session-1")).toBe(
      join(
        conversationsDir,
        "agent-stack-cursor-index",
        "cursor-session-1.json",
      ),
    );
  });

  it("writes and clears the index with start/stop when cursor id is provided", async () => {
    const {
      agentStackCursorIndexPath,
      agentStackDir,
      agentStackStatePath,
      readAgentStackState,
      startAgentStack,
      stopAgentStack,
    } = await loadService();
    const pid = spawnGroupLeader(join(root, "child.pid"));
    mkdirSync(agentStackDir("my-conversation"), { recursive: true });
    writeFileSync(
      agentStackStatePath("my-conversation"),
      JSON.stringify(stackState("my-conversation", pid, workspace)),
    );

    const handle = await startAgentStack("my-conversation", {
      issueId: "story-a",
      cursorConversationId: "cursor-session-1",
    });

    expect(handle.reused).toBe(true);
    expect(readAgentStackState("my-conversation")?.cursorConversationIds).toEqual([
      "cursor-session-1",
    ]);
    expect(
      JSON.parse(readFileSync(agentStackCursorIndexPath("cursor-session-1"), "utf8")),
    ).toEqual({ appConversationId: "my-conversation" });

    await stopAgentStack("my-conversation");

    expect(existsSync(agentStackStatePath("my-conversation"))).toBe(false);
    expect(existsSync(agentStackCursorIndexPath("cursor-session-1"))).toBe(false);
  });

  it("indexes a second concurrent conversation under a different cursor id", async () => {
    const {
      agentStackCursorIndexPath,
      agentStackDir,
      agentStackStatePath,
      startAgentStack,
      stopAgentStack,
    } = await loadService();

    const pidA = spawnGroupLeader(join(root, "child-a.pid"));
    const pidB = spawnGroupLeader(join(root, "child-b.pid"));
    for (const [conversationId, pid, port, auxPort, worktreePath, issueId] of [
      ["conv-a", pidA, 41002, 41001, workspace, "story-a"],
      ["conv-b", pidB, 41004, 41003, workspaceB, "story-b"],
    ] as const) {
      mkdirSync(agentStackDir(conversationId), { recursive: true });
      writeFileSync(
        agentStackStatePath(conversationId),
        JSON.stringify({
          ...stackState(conversationId, pid, worktreePath, port, auxPort),
          issueId,
        }),
      );
    }

    const a = await startAgentStack("conv-a", {
      issueId: "story-a",
      cursorConversationId: "cursor-a",
    });
    const b = await startAgentStack("conv-b", {
      issueId: "story-b",
      cursorConversationId: "cursor-b",
    });

    expect(a.state.port).not.toBe(b.state.port);
    expect(a.state.auxPort).not.toBe(b.state.auxPort);
    expect(
      JSON.parse(readFileSync(agentStackCursorIndexPath("cursor-a"), "utf8")),
    ).toEqual({ appConversationId: "conv-a" });
    expect(
      JSON.parse(readFileSync(agentStackCursorIndexPath("cursor-b"), "utf8")),
    ).toEqual({ appConversationId: "conv-b" });

    await stopAgentStack("conv-a");
    await stopAgentStack("conv-b");
    expect(existsSync(agentStackCursorIndexPath("cursor-a"))).toBe(false);
    expect(existsSync(agentStackCursorIndexPath("cursor-b"))).toBe(false);
  });
});

describe("agent stack liveness", () => {
  it("pins a recorded pid to the process that was started", async () => {
    const { isProcessLive } = await loadService();
    const pid = spawnGroupLeader(join(root, "child.pid"));

    expect(isProcessLive({ role: "api", pid, startTime: procStartTime(pid) })).toBe(
      true,
    );
    expect(isProcessLive({ role: "api", pid, startTime: "1" })).toBe(false);
  });

  it("treats a pid that no longer exists as dead", async () => {
    const { isProcessLive } = await loadService();

    expect(isProcessLive({ role: "vite", pid: 2 ** 30, startTime: "1" })).toBe(false);
  });
});

describe("stopAgentStack", () => {
  async function recordStack(conversationId: string, pid: number) {
    const { agentStackDir, agentStackStatePath } = await loadService();
    mkdirSync(agentStackDir(conversationId), { recursive: true });
    writeFileSync(
      agentStackStatePath(conversationId),
      JSON.stringify(stackState(conversationId, pid, workspace)),
    );
  }

  it("succeeds when the conversation never started a stack", async () => {
    const { stopAgentStack } = await loadService();

    await expect(stopAgentStack("my-conversation")).resolves.toEqual({
      stopped: false,
      state: null,
      memoryLimitFailures: [],
    });
  });

  it("kills the whole process group and clears ownership", async () => {
    const { agentStackStatePath, stopAgentStack } = await loadService();
    const childPidFile = join(root, "child.pid");
    const leaderPid = spawnGroupLeader(childPidFile);
    const forkedPid = Number(await waitForFile(childPidFile));
    await recordStack("my-conversation", leaderPid);

    const result = await stopAgentStack("my-conversation");

    expect(result.stopped).toBe(true);
    expect(isCollected(leaderPid)).toBe(true);
    expect(await waitForCollection(forkedPid)).toBe(true);
    expect(existsSync(agentStackStatePath("my-conversation"))).toBe(false);
    const { liveBrowserOriginBaseUrl } = await import(
      "./browser-origin-allowlist.js"
    );
    expect(
      liveBrowserOriginBaseUrl(agentStackStatePath("my-conversation")),
    ).toBeNull();
  });

  it("clears state left behind by processes that already died", async () => {
    const { agentStackStatePath, stopAgentStack } = await loadService();
    const pid = spawnGroupLeader(join(root, "child.pid"));
    await recordStack("my-conversation", pid);
    process.kill(-pid, "SIGKILL");

    const result = await stopAgentStack("my-conversation");

    expect(result.stopped).toBe(true);
    expect(existsSync(agentStackStatePath("my-conversation"))).toBe(false);
  });

  it("drops a recorded pid owned by another process without signaling it", async () => {
    const { agentStackStatePath, stopAgentStack } = await loadService();
    const pidFile = join(root, "held.pid");
    const holder = spawn(
      "sh",
      ["-c", `sleep 300 & echo $! > ${pidFile}; wait`],
      { detached: true, stdio: "ignore" },
    );
    strays.push(holder);
    const childPid = Number(await waitForFile(pidFile));
    await recordStack("my-conversation", childPid);
    const before = procInfo(childPid);
    const kill = vi.spyOn(process, "kill");
    try {
      const result = await stopAgentStack("my-conversation");
      expect(result.stopped).toBe(true);
      expect(existsSync(agentStackStatePath("my-conversation"))).toBe(false);
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
      const { stopAgentStack } = await loadService();
      const child = spawn("sh", ["-c", "trap '' TERM; sleep 300"], {
        detached: true,
        stdio: "ignore",
      });
      strays.push(child);
      const pid = child.pid!;
      await recordStack("my-conversation", pid);
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
        const outcome = stopAgentStack("my-conversation").then(
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
});

describe("startAgentStack", () => {
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
      const { startAgentStack } = await import("./agent-stack.js");
      await expect(
        startAgentStack("my-conversation", { issueId: "   " }),
      ).rejects.toThrow(/issueId is required/);
      expect(reaperCalls).toEqual(["ensure"]);
    } finally {
      vi.doUnmock("./child-reaper.js");
      vi.resetModules();
    }
  });

  it("refuses a missing issue id before spawn", async () => {
    const { startAgentStack } = await loadService();

    await expect(
      startAgentStack("my-conversation", { issueId: "   " }),
    ).rejects.toThrow(/issueId is required/);
  });

  it("adopts the live stack when the worktree matches", async () => {
    const { agentStackDir, agentStackStatePath, startAgentStack } =
      await loadService();
    const pid = spawnGroupLeader(join(root, "child.pid"));
    mkdirSync(agentStackDir("my-conversation"), { recursive: true });
    writeFileSync(
      agentStackStatePath("my-conversation"),
      JSON.stringify(stackState("my-conversation", pid, workspace)),
    );

    const handle = await startAgentStack("my-conversation", { issueId: "story-a" });

    const { liveBrowserOriginBaseUrl } = await import(
      "./browser-origin-allowlist.js"
    );
    expect(liveBrowserOriginBaseUrl(agentStackStatePath("my-conversation"))).toBe(
      "http://127.0.0.1:41002",
    );
    expect(handle.reused).toBe(true);
    expect(handle.env.AGENT_STACK_BASE_URL).toBe("http://127.0.0.1:41002");
    expect(handle.state.port).toBe(41002);
    expect(handle.state.auxPort).toBe(41001);
    expect(handle.state.worktree).toBe(workspace);
  });

  it("stops a live stack when the worktree differs", async () => {
    const {
      agentStackDir,
      agentStackStatePath,
      startAgentStack,
      stopAgentStack,
    } = await loadService();
    const pid = spawnGroupLeader(join(root, "child.pid"));
    mkdirSync(agentStackDir("my-conversation"), { recursive: true });
    writeFileSync(
      agentStackStatePath("my-conversation"),
      JSON.stringify(stackState("my-conversation", pid, workspace)),
    );

    spawnDelegate.impl = (_command, _args, options) => {
      const child = realSpawn(
        "node",
        [
          "-e",
          "require('net').createServer().listen(Number(process.env.AGENT_STACK_PORT),'127.0.0.1'); setInterval(() => {}, 1e9);",
        ],
        {
          ...(options ?? {}),
          detached: true,
          stdio: "ignore",
        },
      );
      strays.push(child);
      return child;
    };

    const handle = await startAgentStack("my-conversation", {
      issueId: "story-b",
    });

    expect(isCollected(pid)).toBe(true);
    expect(handle.reused).toBe(false);
    expect(handle.state.worktree).toBe(resolve(workspaceB));
    expect(readFileSync(agentStackStatePath("my-conversation"), "utf8")).toContain(
      workspaceB,
    );

    await stopAgentStack("my-conversation");
  });
});

describe("child reaper", () => {
  it("collects a detached child when it exits without adopting it to pid 1", async () => {
    const { ensureChildReaper } = await import("./child-reaper.js");
    ensureChildReaper();
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    strays.push(child);
    child.unref();
    const info = procInfo(child.pid!);
    expect(info?.ppid).toBe(process.pid);
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.on("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    process.kill(child.pid!, "SIGTERM");
    expect(await exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(await waitForCollection(child.pid!)).toBe(true);
  });

  it("collects a grandchild whose parent has exited", async () => {
    const { ensureChildReaper } = await import("./child-reaper.js");
    ensureChildReaper();
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
});

describe("dropUnownedAgentStackRecords", () => {
  it("removes an unowned record and its cursor index without signaling", async () => {
    const {
      agentStackCursorIndexPath,
      agentStackDir,
      agentStackStatePath,
      dropUnownedAgentStackRecords,
    } = await loadService();
    const pidFile = join(root, "held.pid");
    const holder = spawn(
      "sh",
      ["-c", `sleep 300 & echo $! > ${pidFile}; wait`],
      { detached: true, stdio: "ignore" },
    );
    strays.push(holder);
    const childPid = Number(await waitForFile(pidFile));
    mkdirSync(agentStackDir("my-conversation"), { recursive: true });
    const state = {
      ...stackState("my-conversation", childPid, workspace),
      cursorConversationIds: ["cursor-session-1"],
    };
    writeFileSync(agentStackStatePath("my-conversation"), JSON.stringify(state));
    mkdirSync(dirname(agentStackCursorIndexPath("cursor-session-1")), {
      recursive: true,
    });
    writeFileSync(
      agentStackCursorIndexPath("cursor-session-1"),
      `${JSON.stringify({ appConversationId: "my-conversation" })}\n`,
    );
    const kill = vi.spyOn(process, "kill");
    try {
      expect(dropUnownedAgentStackRecords()).toEqual(["my-conversation"]);
      expect(
        kill.mock.calls.some((call) => Math.abs(Number(call[0])) === childPid),
      ).toBe(false);
    } finally {
      kill.mockRestore();
    }
    expect(existsSync(agentStackStatePath("my-conversation"))).toBe(false);
    expect(existsSync(agentStackCursorIndexPath("cursor-session-1"))).toBe(false);
    expect(procInfo(childPid)?.ppid).not.toBe(process.pid);
    expect(procInfo(childPid)?.state).not.toBe("Z");
  });

  it("keeps a record whose pid is this process's child", async () => {
    const { agentStackDir, agentStackStatePath, dropUnownedAgentStackRecords } =
      await loadService();
    const child = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
    strays.push(child);
    mkdirSync(agentStackDir("my-conversation"), { recursive: true });
    writeFileSync(
      agentStackStatePath("my-conversation"),
      JSON.stringify(stackState("my-conversation", child.pid!, workspace)),
    );

    expect(dropUnownedAgentStackRecords()).toEqual([]);
    expect(existsSync(agentStackStatePath("my-conversation"))).toBe(true);
  });
});

const HEAP_OOM_EVENT = "Allocation failed - JavaScript heap out of memory";

function writeHeapLimitReport(
  heapReportsDir: string,
  commandLine: string[],
): void {
  mkdirSync(heapReportsDir, { recursive: true });
  writeFileSync(
    join(heapReportsDir, `report.1.127.0.0.1.${Date.now()}.json`),
    JSON.stringify({ header: { event: HEAP_OOM_EVENT, commandLine } }),
  );
}

describe("agent stack heap limit reporting", () => {
  async function recordDeadStack(conversationId: string, dataDir: string) {
    const { agentStackDir, agentStackStatePath } = await loadService();
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(agentStackDir(conversationId), { recursive: true });
    const deadPid = 2 ** 30;
    writeFileSync(
      agentStackStatePath(conversationId),
      JSON.stringify({
        conversationId,
        issueId: "story-a",
        worktree: workspace,
        port: 41002,
        auxPort: 41001,
        dataDir,
        baseUrl: "http://127.0.0.1:41002",
        startedAt: STAMP,
        processes: [{ role: "start" as const, pid: deadPid, startTime: "1" }],
        cursorConversationIds: [],
      }),
    );
  }

  function spawnRuntimeStartListener(): typeof spawnDelegate.impl {
    return (_command, _args, options) => {
      const child = realSpawn(
        "node",
        [
          "-e",
          "require('net').createServer().listen(Number(process.env.AGENT_STACK_PORT),'127.0.0.1'); setInterval(() => {}, 1e9);",
        ],
        {
          ...(options ?? {}),
          detached: true,
          stdio: "ignore",
        },
      );
      strays.push(child);
      return child;
    };
  }

  it("start on a dead recorded stack returns the line in memoryLimitFailures and restarts", async () => {
    spawnDelegate.impl = spawnRuntimeStartListener();
    const { conversationsDir } = await loadConfig();
    const dataDir = join(
      conversationsDir,
      "my-conversation",
      "agent-stack",
      "data",
    );
    const commandLine = ["node", "server.js"];
    writeHeapLimitReport(join(dataDir, "heap-reports"), commandLine);
    await recordDeadStack("my-conversation", dataDir);

    const { startAgentStack, agentStackMemoryLimitMessage, stopAgentStack } =
      await loadService();
    const handle = await startAgentStack("my-conversation", { issueId: "story-a" });

    expect(handle.memoryLimitFailures).toEqual([
      agentStackMemoryLimitMessage(commandLine),
    ]);
    expect(handle.reused).toBe(false);
    expect(handle.state.processes[0]!.pid).not.toBe(2 ** 30);

    await stopAgentStack("my-conversation");
  });

  it("stop returns heap-limit lines in memoryLimitFailures", async () => {
    const { conversationsDir } = await loadConfig();
    const dataDir = join(
      conversationsDir,
      "my-conversation",
      "agent-stack",
      "data",
    );
    const commandLine = ["node", "vite.js"];
    writeHeapLimitReport(join(dataDir, "heap-reports"), commandLine);
    await recordDeadStack("my-conversation", dataDir);

    const { stopAgentStack, agentStackMemoryLimitMessage } = await loadService();
    const result = await stopAgentStack("my-conversation");

    expect(result.stopped).toBe(true);
    expect(result.memoryLimitFailures).toEqual([
      agentStackMemoryLimitMessage(commandLine),
    ]);
  });

  it("leaves memoryLimitFailures empty when the report event is not heap exhaustion", async () => {
    const { conversationsDir } = await loadConfig();
    const dataDir = join(
      conversationsDir,
      "my-conversation",
      "agent-stack",
      "data",
    );
    mkdirSync(join(dataDir, "heap-reports"), { recursive: true });
    writeFileSync(
      join(dataDir, "heap-reports", `report.1.127.0.0.1.${Date.now()}.json`),
      JSON.stringify({
        header: { event: "other", commandLine: ["node", "server.js"] },
      }),
    );
    await recordDeadStack("my-conversation", dataDir);

    const { stopAgentStack } = await loadService();
    const result = await stopAgentStack("my-conversation");

    expect(result.memoryLimitFailures).toEqual([]);
  });
});

describe("agent stack memory hardening", () => {
  function isDetachedStartPhaseSpawn(
    command: string,
    args: readonly string[],
    options: import("node:child_process").SpawnOptions | undefined,
  ): boolean {
    const env = options?.env as NodeJS.ProcessEnv | undefined;
    return (
      command === "sh" &&
      args[0] === "-c" &&
      options?.detached === true &&
      env?.AGENT_STACK_PORT !== undefined
    );
  }

  function spawnPhaseStartWithCapturedEnv(
    capturedEnvs: NodeJS.ProcessEnv[],
  ): typeof spawnDelegate.impl {
    return (command, args, options) => {
      if (isDetachedStartPhaseSpawn(command, args, options)) {
        capturedEnvs.push({ ...(options?.env as NodeJS.ProcessEnv) });
        const child = realSpawn(
          "node",
          [
            "-e",
            "require('net').createServer().listen(Number(process.env.AGENT_STACK_PORT),'127.0.0.1'); setInterval(() => {}, 1e9);",
          ],
          {
            ...(options ?? {}),
            detached: true,
            stdio: "ignore",
          },
        );
        strays.push(child);
        return child;
      }
      const child = realSpawn(command, args, options ?? {});
      if (options?.detached) strays.push(child);
      return child;
    };
  }

  function spawnPhaseStartWithNodeChild(
    nodePidFile: string,
  ): typeof spawnDelegate.impl {
    return (command, args, options) => {
      if (command === "sh" && args[1]?.includes("oom_score_adj")) {
        const nodeScript =
          `require('fs').writeFileSync(${JSON.stringify(nodePidFile)}, String(process.pid)); ` +
          "require('net').createServer().listen(Number(process.env.AGENT_STACK_PORT),'127.0.0.1'); " +
          "setInterval(()=>{}, 1e9);";
        const patched = [...args];
        const wrapped = patched[1]!;
        patched[1] = wrapped.replace(
          /; sleep 30$/,
          `; node -e ${JSON.stringify(nodeScript)}`,
        );
        if (patched[1] === wrapped) {
          throw new Error("expected seeded runtime start command in wrapped script");
        }
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
    };
  }

  it("appends heap limit NODE_OPTIONS when spawning a runtime phase", async () => {
    vi.stubEnv("NODE_OPTIONS", "--enable-source-maps");
    const capturedEnvs: NodeJS.ProcessEnv[] = [];
    spawnDelegate.impl = spawnPhaseStartWithCapturedEnv(capturedEnvs);

    const { startAgentStack, stopAgentStack } = await loadService();
    const { conversationsDir } = await loadConfig();

    await startAgentStack("my-conversation", { issueId: "story-a" });

    expect(capturedEnvs.length).toBeGreaterThan(0);
    const env = capturedEnvs[0]!;
    const dataDir = join(conversationsDir, "my-conversation", "agent-stack", "data");
    const heapReports = join(dataDir, "heap-reports");
    expect(env.NODE_OPTIONS).toContain("--enable-source-maps");
    expect(env.NODE_OPTIONS).toContain("--max-old-space-size=2048");
    expect(env.NODE_OPTIONS).toContain("--report-on-fatalerror");
    expect(env.NODE_OPTIONS).toContain(`--report-directory=${heapReports}`);

    await stopAgentStack("my-conversation");
  });

  it.skipIf(process.platform !== "linux")(
    "sets oom_score_adj to 1000 on the phase shell and its Node child",
    async () => {
      const nodePidFile = join(root, "node.pid");
      spawnDelegate.impl = spawnPhaseStartWithNodeChild(nodePidFile);
      const serverOomBefore = readFileSync("/proc/self/oom_score_adj", "utf8").trim();

      const { startAgentStack, stopAgentStack } = await loadService();

      const handle = await startAgentStack("my-conversation", { issueId: "story-a" });
      const shellPid = handle.state.processes[0]!.pid;
      const nodePid = Number(await waitForFile(nodePidFile));

      expect(readFileSync(`/proc/${shellPid}/oom_score_adj`, "utf8").trim()).toBe("1000");
      expect(readFileSync(`/proc/${nodePid}/oom_score_adj`, "utf8").trim()).toBe("1000");
      expect(readFileSync("/proc/self/oom_score_adj", "utf8").trim()).toBe(
        serverOomBefore,
      );

      await stopAgentStack("my-conversation");
    },
  );
});

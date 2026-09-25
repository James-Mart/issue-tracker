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

function seedWorkspaceApp(dir: string, withNodeModules = true): void {
  const appDir = join(dir, "app");
  mkdirSync(appDir, { recursive: true });
  if (withNodeModules) {
    const binDir = join(appDir, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    for (const name of ["tsx", "vite"]) {
      writeFileSync(join(binDir, name), "#!/bin/sh\nexit 0\n");
    }
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
  seedWorkspaceApp(workspace);
  seedWorkspaceApp(workspaceB);
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
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

function stubReadyFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200 }) as Response),
  );
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
  workspacePath: string,
  apiPort = 41001,
  vitePort = 41002,
) {
  return {
    conversationId,
    workspace: workspacePath,
    apiPort,
    vitePort,
    baseUrl: `http://127.0.0.1:${vitePort}`,
    startedAt: "2026-01-01T00:00:00.000Z",
    processes: [{ role: "api", pid, startTime: procStartTime(pid) }],
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
        workspace,
        apiPort: 41001,
        vitePort: 41002,
        baseUrl: "http://127.0.0.1:41002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [],
        cursorConversationIds: [],
      }),
    ).toEqual({
      AGENT_STACK_API_PORT: "41001",
      AGENT_STACK_VITE_PORT: "41002",
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
      workspace,
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
    for (const [conversationId, pid, apiPort, vitePort, workspacePath] of [
      ["conv-a", pidA, 41001, 41002, workspace],
      ["conv-b", pidB, 41003, 41004, workspaceB],
    ] as const) {
      mkdirSync(agentStackDir(conversationId), { recursive: true });
      writeFileSync(
        agentStackStatePath(conversationId),
        JSON.stringify(
          stackState(conversationId, pid, workspacePath, apiPort, vitePort),
        ),
      );
    }

    const a = await startAgentStack("conv-a", {
      workspace,
      cursorConversationId: "cursor-a",
    });
    const b = await startAgentStack("conv-b", {
      workspace: workspaceB,
      cursorConversationId: "cursor-b",
    });

    expect(a.state.apiPort).not.toBe(b.state.apiPort);
    expect(a.state.vitePort).not.toBe(b.state.vitePort);
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
        startAgentStack("my-conversation", { workspace: "   " }),
      ).rejects.toThrow(/workspace is required/);
      expect(reaperCalls).toEqual(["ensure"]);
    } finally {
      vi.doUnmock("./child-reaper.js");
      vi.resetModules();
    }
  });

  it("refuses a missing workspace before spawn", async () => {
    const { startAgentStack } = await loadService();

    await expect(
      startAgentStack("my-conversation", { workspace: "   " }),
    ).rejects.toThrow(/workspace is required/);
  });

  it("adopts the live stack when the workspace matches", async () => {
    const { agentStackDir, agentStackStatePath, startAgentStack } =
      await loadService();
    const pid = spawnGroupLeader(join(root, "child.pid"));
    mkdirSync(agentStackDir("my-conversation"), { recursive: true });
    writeFileSync(
      agentStackStatePath("my-conversation"),
      JSON.stringify(stackState("my-conversation", pid, workspace)),
    );

    const handle = await startAgentStack("my-conversation", { workspace });

    expect(handle.reused).toBe(true);
    expect(handle.env.AGENT_STACK_BASE_URL).toBe("http://127.0.0.1:41002");
    expect(handle.state.apiPort).toBe(41001);
    expect(handle.state.workspace).toBe(workspace);
  });

  it("stops a live stack when the workspace differs", async () => {
    stubReadyFetch();
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

    spawnDelegate.impl = (command, _args, options) => {
      if (command === "npm") {
        return realSpawn("sh", ["-c", "exit 0"], options ?? {});
      }
      const child = realSpawn("sh", ["-c", "sleep 300"], {
        ...(options ?? {}),
        detached: true,
        stdio: "ignore",
      });
      strays.push(child);
      return child;
    };

    const handle = await startAgentStack("my-conversation", {
      workspace: workspaceB,
    });

    expect(isCollected(pid)).toBe(true);
    expect(handle.reused).toBe(false);
    expect(handle.state.workspace).toBe(resolve(workspaceB));
    expect(readFileSync(agentStackStatePath("my-conversation"), "utf8")).toContain(
      workspaceB,
    );

    await stopAgentStack("my-conversation");
  });

  it("passes the live store env to stack children", async () => {
    stubReadyFetch();
    const { startAgentStack, stopAgentStack } = await loadService();
    const captured: NodeJS.ProcessEnv[] = [];

    spawnDelegate.impl = (command, _args, options) => {
      if (command === "npm") {
        return realSpawn("sh", ["-c", "exit 0"], options ?? {});
      }
      captured.push({ ...(options?.env as NodeJS.ProcessEnv) });
      const child = realSpawn("sh", ["-c", "sleep 300"], {
        ...(options ?? {}),
        detached: true,
        stdio: "ignore",
      });
      strays.push(child);
      return child;
    };

    await startAgentStack("my-conversation", { workspace });

    expect(captured.length).toBeGreaterThan(0);
    for (const env of captured) {
      expect(env.ISSUES_DIR).toBe(issuesDir);
      expect(env.ISSUE_TRACKER_STORE_READ_ONLY).toBe("1");
      expect(env.ISSUE_TRACKER_ASR_MODEL_DIR).toBeTruthy();
    }

    await stopAgentStack("my-conversation");
  });

  it("runs npm install when node_modules is absent and leaves no state on failure", async () => {
    const bareWorkspace = join(root, "bare-workspace");
    mkdirSync(join(bareWorkspace, "app"), { recursive: true });
    const { agentStackStatePath, startAgentStack } = await loadService();

    spawnDelegate.impl = (command, _args, options) => {
      if (command === "npm") {
        return realSpawn("sh", ["-c", "exit 1"], options ?? {});
      }
      return realSpawn("sh", ["-c", "sleep 300"], options ?? {});
    };

    await expect(
      startAgentStack("my-conversation", { workspace: bareWorkspace }),
    ).rejects.toThrow(/npm install/);
    expect(existsSync(agentStackStatePath("my-conversation"))).toBe(false);
  });

  it("runs npm install with skip setup env when node_modules is absent", async () => {
    stubReadyFetch();
    const bareWorkspace = join(root, "install-workspace");
    mkdirSync(join(bareWorkspace, "app"), { recursive: true });
    const { startAgentStack, stopAgentStack } = await loadService();
    let npmEnv: NodeJS.ProcessEnv | undefined;

    spawnDelegate.impl = (command, _args, options) => {
      if (command === "npm") {
        npmEnv = { ...(options?.env as NodeJS.ProcessEnv) };
        seedWorkspaceApp(bareWorkspace);
        return realSpawn("sh", ["-c", "exit 0"], options ?? {});
      }
      const child = realSpawn("sh", ["-c", "sleep 300"], {
        ...(options ?? {}),
        detached: true,
        stdio: "ignore",
      });
      strays.push(child);
      return child;
    };

    await startAgentStack("my-conversation", { workspace: bareWorkspace });

    expect(npmEnv?.ISSUE_TRACKER_SKIP_BROWSER_SETUP).toBe("1");
    expect(npmEnv?.ISSUE_TRACKER_SKIP_ASR_MODEL_SETUP).toBe("1");
    expect(npmEnv?.ISSUE_TRACKER_ASR_MODEL_DIR).toBeTruthy();

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

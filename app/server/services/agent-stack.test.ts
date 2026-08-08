import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let issuesDir: string;
const strays: ChildProcess[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-agent-stack-"));
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

/** A zombie no longer runs — and no longer holds a port — so it does not count. */
function isAlive(pid: number): boolean {
  if (!existsSync(`/proc/${pid}/stat`)) return false;
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
}

async function waitForDeath(pid: number): Promise<boolean> {
  for (let i = 0; i < 100 && isAlive(pid); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !isAlive(pid);
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
        apiPort: 41001,
        vitePort: 41002,
        baseUrl: "http://127.0.0.1:41002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [],
      }),
    ).toEqual({
      AGENT_STACK_API_PORT: "41001",
      AGENT_STACK_VITE_PORT: "41002",
      AGENT_STACK_BASE_URL: "http://127.0.0.1:41002",
    });
  });
});

describe("agent stack liveness", () => {
  it("pins a recorded pid to the process that was started", async () => {
    const { isProcessLive } = await loadService();
    const pid = spawnGroupLeader(join(root, "child.pid"));

    expect(isProcessLive({ role: "api", pid, startTime: procStartTime(pid) })).toBe(
      true,
    );
    // Same pid, different process: what a recycled pid in stale state looks like.
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
      JSON.stringify({
        conversationId,
        apiPort: 41001,
        vitePort: 41002,
        baseUrl: "http://127.0.0.1:41002",
        startedAt: new Date().toISOString(),
        processes: [{ role: "api", pid, startTime: procStartTime(pid) }],
      }),
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
    expect(isAlive(leaderPid)).toBe(false);
    expect(await waitForDeath(forkedPid)).toBe(true);
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
});

describe("startAgentStack", () => {
  it("adopts the conversation's live stack instead of starting a second one", async () => {
    const { agentStackDir, agentStackStatePath, startAgentStack } =
      await loadService();
    const pid = spawnGroupLeader(join(root, "child.pid"));
    mkdirSync(agentStackDir("my-conversation"), { recursive: true });
    writeFileSync(
      agentStackStatePath("my-conversation"),
      JSON.stringify({
        conversationId: "my-conversation",
        apiPort: 41001,
        vitePort: 41002,
        baseUrl: "http://127.0.0.1:41002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [{ role: "api", pid, startTime: procStartTime(pid) }],
      }),
    );

    const handle = await startAgentStack("my-conversation");

    expect(handle.reused).toBe(true);
    expect(handle.env.AGENT_STACK_BASE_URL).toBe("http://127.0.0.1:41002");
    expect(handle.state.apiPort).toBe(41001);
  });
});

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
const strays: ChildProcess[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-stack-"));
  const issuesDir = join(root, "issues");
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
  rmSync(root, { recursive: true, force: true });
});

async function loadService() {
  return import("./mockup-stack.js");
}

async function loadScratch() {
  return import("./mockup-scratch.js");
}

function writeConversationMeta(conversationId: string): void {
  const dir = join(root, "conversations", conversationId);
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

async function waitForCollection(pid: number): Promise<boolean> {
  for (let i = 0; i < 100 && !isCollected(pid); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return isCollected(pid);
}

describe("mockup stack lifecycle", () => {
  it("collects the process group before stop resolves", async () => {
    const { stopMockupStack } = await loadService();
    const { mockupStackStatePath, writeMockupStackState } = await loadScratch();
    writeConversationMeta("my-conversation");
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

  it("does not signal a recycled pid whose start time differs", async () => {
    const { stopMockupStack } = await loadService();
    const { mockupStackStatePath, writeMockupStackState } = await loadScratch();
    writeConversationMeta("my-conversation");
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
});

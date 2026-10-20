import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import {
  killStrayGroups,
  procStartTime,
  trackDetachedGroup,
  waitForPidFile,
} from "./boot-process.test-helpers.js";

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
  killStrayGroups(strays);
  strays.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

async function loadService() {
  return import("./agent-stack.js");
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

async function writeStackFile(conversationId: string, body: unknown) {
  const { agentStackDir, agentStackStatePath } = await loadService();
  mkdirSync(agentStackDir(conversationId), { recursive: true });
  writeFileSync(agentStackStatePath(conversationId), JSON.stringify(body));
}

describe("stopAgentStack", () => {
  async function recordStack(conversationId: string, pid: number) {
    await writeStackFile(conversationId, stackState(conversationId, pid, workspace));
  }

  it("kills the whole process group and clears ownership", async () => {
    const { agentStackStatePath, stopAgentStack } = await loadService();
    const childPidFile = join(root, "child.pid");
    const leaderPid = trackDetachedGroup(strays, childPidFile).pid!;
    const forkedPid = await waitForPidFile(childPidFile);
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

  it("drops a recorded pid owned by another process without signaling it", async () => {
    const { agentStackStatePath, stopAgentStack } = await loadService();
    const pidFile = join(root, "held.pid");
    const holder = spawn(
      "sh",
      ["-c", `sleep 300 & echo $! > ${pidFile}; wait`],
      { detached: true, stdio: "ignore" },
    );
    strays.push(holder);
    const childPid = await waitForPidFile(pidFile);
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
});

describe("startAgentStack", () => {
  it("stops a live stack when the worktree differs", async () => {
    const {
      agentStackDir,
      agentStackStatePath,
      startAgentStack,
      stopAgentStack,
    } = await loadService();
    const pid = trackDetachedGroup(strays, join(root, "child.pid")).pid!;
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

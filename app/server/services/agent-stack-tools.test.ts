import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let issuesDir: string;
let workspace: string;
const strays: ChildProcess[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-agent-stack-tools-"));
  issuesDir = join(root, "issues");
  workspace = join(root, "workspace");
  mkdirSync(issuesDir, { recursive: true });
  writeIssue("proj", { kind: "project", title: "Proj" });
  writeIssue("story-a", {
    kind: "story",
    partOf: "proj",
    worktreePath: workspace,
  });
  mkdirSync(join(workspace, "app", "node_modules", ".bin"), { recursive: true });
  for (const name of ["tsx", "vite"]) {
    writeFileSync(join(workspace, "app", "node_modules", ".bin", name), "#!/bin/sh\n");
  }
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  for (const child of strays) {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already reaped.
      }
    }
  }
  strays.length = 0;
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

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

function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}

function spawnGroupLeader(childPidFile: string): number {
  const child = spawn("sh", ["-c", `sleep 300 & echo $! > ${childPidFile}; wait`], {
    detached: true,
    stdio: "ignore",
  });
  strays.push(child);
  return child.pid!;
}

describe("createAgentStackTools", () => {
  it("exposes session-scoped start/stop with no conversation-id arguments", async () => {
    const { createAgentStackTools } = await import("./agent-stack-tools.js");
    const tools = createAgentStackTools({
      conversationId: "app-conv",
      getCursorConversationId: () => "cursor-1",
    });

    expect(Object.keys(tools).sort()).toEqual([
      "agent_stack_start",
      "agent_stack_stop",
    ]);
    expect(tools.agent_stack_start!.inputSchema).toEqual({
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description:
            "Issue whose Story (itself or its containing Story) has the live worktree to boot.",
        },
      },
      required: ["issueId"],
    });
    expect(tools.agent_stack_stop!.inputSchema).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("starts and stops via the shared lifecycle, writing both state and cursor index", async () => {
    const { createAgentStackTools } = await import("./agent-stack-tools.js");
    const {
      agentStackCursorIndexPath,
      agentStackDir,
      agentStackStatePath,
    } = await import("./agent-stack.js");

    const pid = spawnGroupLeader(join(root, "child.pid"));
    mkdirSync(agentStackDir("app-conv"), { recursive: true });
    writeFileSync(
      agentStackStatePath("app-conv"),
      JSON.stringify({
        conversationId: "app-conv",
        issueId: "story-a",
        worktree: workspace,
        port: 42002,
        auxPort: 42001,
        dataDir: join(root, "data"),
        baseUrl: "http://127.0.0.1:42002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [{ role: "api", pid, startTime: procStartTime(pid) }],
        cursorConversationIds: [],
      }),
    );

    const tools = createAgentStackTools({
      conversationId: "app-conv",
      getCursorConversationId: () => "cursor-session",
    });

    const started = (await tools.agent_stack_start!.execute(
      { issueId: "story-a" },
      {},
    )) as {
      reused: boolean;
      env: Record<string, string>;
      state: { port: number; auxPort: number };
    };

    expect(started.reused).toBe(true);
    expect(started.env).toEqual({
      AGENT_STACK_PORT: "42002",
      AGENT_STACK_AUX_PORT: "42001",
      AGENT_STACK_DATA_DIR: join(root, "data"),
      AGENT_STACK_BASE_URL: "http://127.0.0.1:42002",
    });
    expect(existsSync(agentStackStatePath("app-conv"))).toBe(true);
    expect(
      JSON.parse(readFileSync(agentStackCursorIndexPath("cursor-session"), "utf8")),
    ).toEqual({ appConversationId: "app-conv" });

    const stopped = (await tools.agent_stack_stop!.execute({}, {})) as {
      stopped: boolean;
    };
    expect(stopped.stopped).toBe(true);
    expect(existsSync(agentStackStatePath("app-conv"))).toBe(false);
    expect(existsSync(agentStackCursorIndexPath("cursor-session"))).toBe(false);
  });

  it("fails loudly when the Cursor conversation id is missing from the runtime", async () => {
    const { createAgentStackTools } = await import("./agent-stack-tools.js");
    const tools = createAgentStackTools({
      conversationId: "app-conv",
      getCursorConversationId: () => undefined,
    });

    await expect(
      tools.agent_stack_start!.execute({ issueId: "story-a" }, {}),
    ).rejects.toThrow(/Cursor conversation_id is not available/);
  });

  it("requires issueId in tool input", async () => {
    const { createAgentStackTools } = await import("./agent-stack-tools.js");
    const tools = createAgentStackTools({
      conversationId: "app-conv",
      getCursorConversationId: () => "cursor-1",
    });

    await expect(tools.agent_stack_start!.execute({}, {})).rejects.toThrow(
      /issueId is required/,
    );
  });
});

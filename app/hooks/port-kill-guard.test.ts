import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyPortKill,
  decidePortKillPermission,
  listeningPortsForPid,
  loadOwnedPorts,
} from "./port-kill-guard.mjs";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "port-kill-guard.mjs",
);

function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const startTime = fields[19];
  if (!startTime) throw new Error(`unparseable /proc/${pid}/stat`);
  return startTime;
}

function runHook(
  stdin: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const result = spawnSync("node", [scriptPath], {
    input: stdin,
    encoding: "utf8",
    env,
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

async function listenOnPort(): Promise<{ port: number; close: () => Promise<void>; pid: number }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  return {
    port: address.port,
    pid: process.pid,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("classifyPortKill", () => {
  it("ignores non-kill shell commands", () => {
    expect(classifyPortKill("npm test")).toEqual({ kind: "not-kill" });
    expect(classifyPortKill("fuser 8061/tcp")).toEqual({ kind: "not-kill" });
    expect(classifyPortKill("lsof -ti :8060")).toEqual({ kind: "not-kill" });
  });

  it("detects fuser -k port targets", () => {
    expect(classifyPortKill("fuser -k 8061/tcp")).toEqual({
      kind: "port-kill",
      ports: [8061],
    });
    expect(classifyPortKill("fuser -vk 8060/tcp 8061/tcp")).toEqual({
      kind: "port-kill",
      ports: [8060, 8061],
    });
  });

  it("detects lsof piped/substituted into kill", () => {
    expect(classifyPortKill("kill $(lsof -ti :8060)")).toEqual({
      kind: "port-kill",
      ports: [8060],
    });
    expect(classifyPortKill("lsof -ti :8061 | xargs kill -9")).toEqual({
      kind: "port-kill",
      ports: [8061],
    });
  });

  it("treats fuser -k with no parseable ports as port-kill (fail closed)", () => {
    expect(classifyPortKill("fuser -k")).toEqual({
      kind: "port-kill",
      ports: [],
    });
  });
});

describe("loadOwnedPorts + decidePortKillPermission", () => {
  let root: string;
  let issuesDir: string;
  let conversationsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "port-kill-guard-"));
    issuesDir = join(root, "issues");
    conversationsDir = join(root, "conversations");
    mkdirSync(issuesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeStack(opts: {
    cursorId: string;
    appId: string;
    apiPort: number;
    vitePort: number;
    processes: Array<{ role: "api" | "vite"; pid: number; startTime: string }>;
  }) {
    mkdirSync(join(conversationsDir, "agent-stack-cursor-index"), {
      recursive: true,
    });
    writeFileSync(
      join(
        conversationsDir,
        "agent-stack-cursor-index",
        `${opts.cursorId}.json`,
      ),
      `${JSON.stringify({ appConversationId: opts.appId }, null, 2)}\n`,
    );
    mkdirSync(join(conversationsDir, opts.appId, "agent-stack"), {
      recursive: true,
    });
    writeFileSync(
      join(conversationsDir, opts.appId, "agent-stack", "state.json"),
      `${JSON.stringify(
        {
          conversationId: opts.appId,
          apiPort: opts.apiPort,
          vitePort: opts.vitePort,
          baseUrl: `http://127.0.0.1:${opts.vitePort}`,
          startedAt: "2026-01-01T00:00:00.000Z",
          processes: opts.processes,
          cursorConversationIds: [opts.cursorId],
        },
        null,
        2,
      )}\n`,
    );
  }

  it("returns empty owned ports when index is missing", () => {
    expect(loadOwnedPorts("missing-cursor", conversationsDir).size).toBe(0);
  });

  it("denies kill-shaped commands when index/state is missing", () => {
    expect(
      decidePortKillPermission({
        command: "fuser -k 41001/tcp",
        conversationId: "cursor-1",
        conversationsDir,
      }),
    ).toEqual({
      permission: "deny",
      agent_message: expect.stringContaining("agent_stack_start"),
    });
  });

  it("allows non-kill commands even with no index", () => {
    expect(
      decidePortKillPermission({
        command: "echo hi",
        conversationId: undefined,
        conversationsDir,
      }),
    ).toEqual({ permission: "allow" });
  });

  it("allows kills only for live allowlisted ports", () => {
    const pid = process.pid;
    writeStack({
      cursorId: "cursor-1",
      appId: "app-1",
      apiPort: 41001,
      vitePort: 41002,
      processes: [
        { role: "api", pid, startTime: procStartTime(pid) },
        { role: "vite", pid, startTime: procStartTime(pid) },
      ],
    });

    expect(
      decidePortKillPermission({
        command: "fuser -k 41001/tcp",
        conversationId: "cursor-1",
        conversationsDir,
      }),
    ).toEqual({ permission: "allow" });

    expect(
      decidePortKillPermission({
        command: "fuser -k 8060/tcp",
        conversationId: "cursor-1",
        conversationsDir,
      }),
    ).toEqual({
      permission: "deny",
      agent_message: expect.stringContaining("agent_stack_start"),
    });
  });

  it("does not treat stale recycled-port state as owned", async () => {
    const listener = await listenOnPort();
    try {
      writeStack({
        cursorId: "cursor-1",
        appId: "app-1",
        apiPort: listener.port,
        vitePort: listener.port + 1,
        processes: [
          // Wrong startTime: simulates a crashed stack whose port was reused.
          { role: "api", pid: listener.pid, startTime: "1" },
        ],
      });

      expect(loadOwnedPorts("cursor-1", conversationsDir).has(listener.port)).toBe(
        false,
      );
      expect(
        decidePortKillPermission({
          command: `fuser -k ${listener.port}/tcp`,
          conversationId: "cursor-1",
          conversationsDir,
        }),
      ).toEqual({
        permission: "deny",
        agent_message: expect.stringContaining("agent_stack_start"),
      });
    } finally {
      await listener.close();
    }
  });

  it("resolves bare kill of a listening pid to that port", async () => {
    const listener = await listenOnPort();
    try {
      const ports = listeningPortsForPid(listener.pid);
      expect(ports).toContain(listener.port);

      writeStack({
        cursorId: "cursor-1",
        appId: "app-1",
        apiPort: listener.port,
        vitePort: listener.port + 1,
        processes: [
          { role: "api", pid: listener.pid, startTime: procStartTime(listener.pid) },
        ],
      });

      expect(
        decidePortKillPermission({
          command: `kill ${listener.pid}`,
          conversationId: "cursor-1",
          conversationsDir,
        }),
      ).toEqual({ permission: "allow" });
    } finally {
      await listener.close();
    }
  });
});

describe("port-kill-guard.mjs stdout contract", () => {
  let root: string;
  let issuesDir: string;
  let conversationsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "port-kill-guard-hook-"));
    issuesDir = join(root, "issues");
    conversationsDir = join(root, "conversations");
    mkdirSync(issuesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("denies a foreign port kill with agent_message redirect", () => {
    const { stdout, status } = runHook(
      JSON.stringify({
        conversation_id: "cursor-1",
        tool_input: { command: "fuser -k 8060/tcp" },
      }),
      { ...process.env, ISSUES_DIR: issuesDir },
    );
    expect(status).toBe(0);
    const body = JSON.parse(stdout);
    expect(body.permission).toBe("deny");
    expect(body.agent_message).toContain("agent_stack_start");
    expect(body).not.toHaveProperty("updated_input");
  });

  it("allows an own live allowlisted port kill", () => {
    const pid = process.pid;
    mkdirSync(join(conversationsDir, "agent-stack-cursor-index"), {
      recursive: true,
    });
    writeFileSync(
      join(conversationsDir, "agent-stack-cursor-index", "cursor-1.json"),
      `${JSON.stringify({ appConversationId: "app-1" }, null, 2)}\n`,
    );
    mkdirSync(join(conversationsDir, "app-1", "agent-stack"), {
      recursive: true,
    });
    writeFileSync(
      join(conversationsDir, "app-1", "agent-stack", "state.json"),
      `${JSON.stringify({
        conversationId: "app-1",
        apiPort: 41001,
        vitePort: 41002,
        baseUrl: "http://127.0.0.1:41002",
        startedAt: "2026-01-01T00:00:00.000Z",
        processes: [
          { role: "api", pid, startTime: procStartTime(pid) },
          { role: "vite", pid, startTime: procStartTime(pid) },
        ],
      })}\n`,
    );

    const { stdout, status } = runHook(
      JSON.stringify({
        conversation_id: "cursor-1",
        tool_input: { command: "kill $(lsof -ti :41001)" },
      }),
      { ...process.env, ISSUES_DIR: issuesDir },
    );
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ permission: "allow" });
  });

  it("allows non-kill commands and malformed JSON", () => {
    const ok = runHook(
      JSON.stringify({ tool_input: { command: "ls" } }),
      { ...process.env, ISSUES_DIR: issuesDir },
    );
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual({ permission: "allow" });

    const bad = runHook("{not-json", { ...process.env, ISSUES_DIR: issuesDir });
    expect(bad.status).toBe(0);
    expect(JSON.parse(bad.stdout)).toEqual({ permission: "allow" });
  });
});

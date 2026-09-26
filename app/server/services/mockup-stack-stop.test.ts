import { spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let issuesDir: string;
const strays: ChildProcess[] = [];
const foreignLeaders: number[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-mockup-stack-stop-"));
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

function writeConversationMeta(conversationsDir: string, conversationId: string): void {
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
    }),
  );
}

function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}

function procPpid(pid: number): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
}

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (accepted: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(accepted);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
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

/** Detached listener whose parent is not this process. */
async function spawnForeignListener(infoFile: string): Promise<{ pid: number; port: number }> {
  const holder = spawn(
    "python3",
    [
      "-c",
      `import os, socket, time
pid = os.fork()
if pid == 0:
    os.setsid()
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(1)
    port = sock.getsockname()[1]
    open(${JSON.stringify(infoFile)}, "w").write(f"{os.getpid()} {port}")
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
  const [pidText, portText] = (await waitForFile(infoFile)).split(" ");
  const pid = Number(pidText);
  foreignLeaders.push(pid);
  return { pid, port: Number(portText) };
}

describe("stop releases a stack this process did not start", () => {
  it("resolves only after the foreign listener's port is free", async () => {
    const { stopMockupStack } = await loadService();
    const { mockupStackStatePath, writeMockupStackState } = await loadScratch();
    const { conversationsDir } = await loadConfig();
    writeConversationMeta(conversationsDir, "my-conversation");
    const listener = await spawnForeignListener(join(root, "listen.txt"));
    expect(procPpid(listener.pid)).not.toBe(process.pid);
    expect(await portAccepts(listener.port)).toBe(true);
    writeMockupStackState("my-conversation", {
      port: listener.port,
      pid: listener.pid,
      startTime: procStartTime(listener.pid),
      baseUrl: `http://127.0.0.1:${listener.port}`,
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await stopMockupStack("my-conversation");

    expect(result.stopped).toBe(true);
    if (result.stopped) expect(result.state.port).toBe(listener.port);
    expect(await portAccepts(listener.port)).toBe(false);
    expect(existsSync(`/proc/${listener.pid}`)).toBe(false);
    expect(existsSync(mockupStackStatePath("my-conversation"))).toBe(false);
  });

  it("stop --all reports the foreign listener's port only once it is free", async () => {
    const { stopAllMockupStacks } = await loadService();
    const { conversationsDir } = await loadConfig();
    const listener = await spawnForeignListener(join(root, "listen-all.txt"));
    expect(procPpid(listener.pid)).not.toBe(process.pid);
    const statePath = join(
      conversationsDir,
      "cli-conversation",
      "mockups",
      "mockup-stack",
      "state.json",
    );
    mkdirSync(join(statePath, ".."), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        port: listener.port,
        pid: listener.pid,
        startTime: procStartTime(listener.pid),
        baseUrl: `http://127.0.0.1:${listener.port}`,
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const freed = await stopAllMockupStacks();

    expect(freed).toEqual([
      { conversationId: "cli-conversation", port: listener.port },
    ]);
    expect(await portAccepts(listener.port)).toBe(false);
    expect(existsSync(`/proc/${listener.pid}`)).toBe(false);
    expect(existsSync(statePath)).toBe(false);
  });

  it(
    "stop --all rejects and keeps state when the group survives SIGKILL",
    async () => {
      const { stopAllMockupStacks } = await loadService();
      const { conversationsDir } = await loadConfig();
      const child = spawn("sh", ["-c", "trap '' TERM; sleep 300"], {
        detached: true,
        stdio: "ignore",
      });
      strays.push(child);
      const pid = child.pid!;
      const statePath = join(
        conversationsDir,
        "stuck-conversation",
        "mockups",
        "mockup-stack",
        "state.json",
      );
      mkdirSync(join(statePath, ".."), { recursive: true });
      writeFileSync(
        statePath,
        JSON.stringify({
          port: 41021,
          pid,
          startTime: procStartTime(pid),
          baseUrl: "http://127.0.0.1:41021",
          startedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      const realKill = process.kill.bind(process);
      const spy = vi.spyOn(process, "kill").mockImplementation(((
        target: number,
        signal?: NodeJS.Signals | number,
      ) => {
        if (signal === "SIGTERM" || signal === "SIGKILL") return true;
        return realKill(target, signal as NodeJS.Signals);
      }) as typeof process.kill);
      try {
        await expect(stopAllMockupStacks()).rejects.toThrow(/survived SIGKILL/);
        expect(existsSync(statePath)).toBe(true);
        expect(existsSync(`/proc/${pid}`)).toBe(true);
      } finally {
        spy.mockRestore();
      }
    },
    20_000,
  );
});

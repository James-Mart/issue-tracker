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
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let issuesDir: string;
let worktree: string;

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

let scriptSeq = 0;

function nodeScript(source: string): string {
  scriptSeq += 1;
  const path = join(root, `phase-${scriptSeq}.cjs`);
  writeFileSync(path, source);
  return `node ${JSON.stringify(path)}`;
}

function recordedPhase(orderFile: string, phase: string, extra = ""): string {
  return nodeScript(`
    const fs = require("fs");
    if (process.cwd() !== ${JSON.stringify(worktree)}) process.exit(2);
    const base = process.env.AGENT_STACK_BASE_URL ?? "";
    fs.appendFileSync(${JSON.stringify(orderFile)}, [
      ${JSON.stringify(phase)},
      process.env.AGENT_STACK_PORT,
      process.env.AGENT_STACK_AUX_PORT,
      process.env.AGENT_STACK_DATA_DIR,
      base,
    ].join("\\t") + "\\n");
    ${extra}
  `);
}

function listenOnStackPort(delayMs: number): string {
  return `
    const net = require("net");
    setTimeout(() => {
      net.createServer().listen(Number(process.env.AGENT_STACK_PORT), "127.0.0.1");
    }, ${delayMs});
    setInterval(() => {}, 1e9);
  `;
}

function listenLater(orderFile: string): string {
  return recordedPhase(orderFile, "start", listenOnStackPort(300));
}

function seedPhase(orderFile: string): string {
  return nodeScript(`
    const fs = require("fs");
    const net = require("net");
    if (process.cwd() !== ${JSON.stringify(worktree)}) process.exit(2);
    const socket = net.connect(Number(process.env.AGENT_STACK_PORT), "127.0.0.1", () => {
      const base = process.env.AGENT_STACK_BASE_URL ?? "";
      fs.appendFileSync(${JSON.stringify(orderFile)}, [
        "seed",
        process.env.AGENT_STACK_PORT,
        process.env.AGENT_STACK_AUX_PORT,
        process.env.AGENT_STACK_DATA_DIR,
        base,
      ].join("\\t") + "\\n");
      socket.end();
    });
    socket.on("error", () => process.exit(1));
  `);
}

interface PhaseRow {
  phase: string;
  port: string;
  aux: string;
  data: string;
  base: string;
}

function readPhases(orderFile: string): PhaseRow[] {
  return readFileSync(orderFile, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [phase, port, aux, data, base] = line.split("\t");
      return {
        phase: phase!,
        port: port!,
        aux: aux!,
        data: data!,
        base: base ?? "",
      };
    });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-agent-stack-runtime-"));
  issuesDir = join(root, "issues");
  worktree = join(root, "worktree");
  mkdirSync(issuesDir, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(async () => {
  const { stopAgentStack } = await import("./agent-stack.js");
  await stopAgentStack("conv");
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function loadService() {
  return import("./agent-stack.js");
}

describe("declared runtime boot", () => {
  it("runs build, start, port wait, seed, and readiness in order with the phase env", async () => {
    vi.stubEnv("AGENT_STACK_BASE_URL", "http://leaked.example");
    const orderFile = join(root, "order");
    seedProject({
      build: recordedPhase(orderFile, "build"),
      start: listenLater(orderFile),
      seed: seedPhase(orderFile),
      readiness: recordedPhase(orderFile, "readiness"),
      baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
    });
    const { startAgentStack, stopAgentStack } = await loadService();

    const handle = await startAgentStack("conv", { issueId: "task-a" });
    const rows = readPhases(orderFile);

    expect(rows.map((row) => row.phase)).toEqual([
      "build",
      "start",
      "seed",
      "readiness",
    ]);
    for (const row of rows) {
      expect(row.port).toBe(handle.env.AGENT_STACK_PORT);
      expect(row.aux).toBe(handle.env.AGENT_STACK_AUX_PORT);
      expect(row.data).toBe(handle.env.AGENT_STACK_DATA_DIR);
    }
    for (const row of rows.filter((row) => row.phase === "build" || row.phase === "start")) {
      expect(row.base).toBe("");
    }
    for (const row of rows.filter((row) => row.phase === "seed" || row.phase === "readiness")) {
      expect(row.base).toBe(handle.env.AGENT_STACK_BASE_URL);
    }
    expect(handle.env.AGENT_STACK_BASE_URL).toBe(
      `http://127.0.0.1:${handle.env.AGENT_STACK_PORT}`,
    );
    expect(existsSync(handle.env.AGENT_STACK_DATA_DIR!)).toBe(true);

    await stopAgentStack("conv");
  });

  it("cancels a boot during build and the blocked start throws boot cancelled", async () => {
    const pidFile = join(root, "build-child.pid");
    const gate = join(root, "build-gate");
    seedProject({
      build: holdOpen(pidFile, gate),
      start: listenNow(),
      baseUrl: "http://127.0.0.1:$AGENT_STACK_PORT",
    });
    const { agentStackStatePath, readAgentStackState, startAgentStack, stopAgentStack } =
      await loadService();
    const pending = startAgentStack("conv", { issueId: "task-a" });
    let childPid = 0;
    try {
      const state = await waitForPhase(readAgentStackState, "build");
      childPid = Number(await waitForFile(pidFile));
      expect(state.processes).toEqual([]);
      expect(state.bootPhase?.phase).toBe("build");
      expect(existsSync(`/proc/${childPid}`)).toBe(true);
      expect(existsSync(state.dataDir)).toBe(true);

      const stopped = await stopAgentStack("conv");

      expect(stopped.stopped).toBe(true);
      expect(existsSync(`/proc/${childPid}`)).toBe(false);
      expect(existsSync(state.dataDir)).toBe(false);
      expect(existsSync(agentStackStatePath("conv"))).toBe(false);
      await expect(pending).rejects.toThrow(/boot cancelled/);
    } finally {
      writeFileSync(gate, "");
      if (childPid !== 0 && existsSync(`/proc/${childPid}`)) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // The boot cancel already collected it.
        }
      }
      await pending.catch(() => undefined);
    }
  });
});

function seedProject(runtime: Record<string, unknown>): void {
  writeIssue("proj", { kind: "project", runtime });
  writeIssue("story-a", {
    kind: "story",
    partOf: "proj",
    worktreePath: worktree,
  });
  writeIssue("task-a", { kind: "task", partOf: "story-a" });
}

function listenNow(): string {
  return nodeScript(listenOnStackPort(0));
}

function holdOpen(pidFile: string, gateFile: string): string {
  return `sleep 30 & echo $! > ${JSON.stringify(pidFile)}; while [ ! -e ${JSON.stringify(gateFile)} ]; do sleep 0.05; done`;
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const body = readFileSync(path, "utf8").trim();
      if (body) return body;
    }
    await delay(20);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForPhase(
  readAgentStackState: (conversationId: string) => {
    processes: { pid: number }[];
    dataDir: string;
    bootPhase?: { phase: string };
  } | null,
  phase: string,
) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const state = readAgentStackState("conv");
    if (state?.bootPhase?.phase === phase) return state;
    await delay(20);
  }
  throw new Error(`boot never reached ${phase}`);
}

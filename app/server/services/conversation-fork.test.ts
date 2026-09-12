import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "../schemas/conversation.js";

const AT_T1 = "2026-07-09T14:00:00.000Z";
const AT_T1_END = "2026-07-09T14:00:05.000Z";
const AT_T1_TRAILING = "2026-07-09T14:00:07.000Z";
const AT_T2 = "2026-07-09T14:01:00.000Z";
const AT_T2_MID = "2026-07-09T14:01:30.000Z";
const AT_T2_END = "2026-07-09T14:01:45.000Z";
const AT_RECOVERY = "2026-07-09T14:00:02.500Z";

const T1_MS = Date.parse(AT_T1);
const T1_END_MS = Date.parse(AT_T1_END);
const T2_MS = Date.parse(AT_T2);
const T2_END_MS = Date.parse(AT_T2_END);

let root: string;
let issuesDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "conversation-fork-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function loadResolveForkPoint() {
  const mod = await import("./conversation-fork.js");
  return mod.resolveForkPoint;
}

function conversationDir(id: string): string {
  return join(root, "conversations", id);
}

function writeConversation(
  id: string,
  opts: {
    transcript: TranscriptEvent[];
    runs: Record<string, unknown>[];
  },
): void {
  const dir = conversationDir(id);
  const storeDir = join(dir, "agent-state");
  mkdirSync(storeDir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    `${JSON.stringify(
      {
        id,
        title: "Fork test",
        projectId: "platform",
        model: "composer-2.5",
        createdAt: AT_T1,
        updatedAt: AT_T1,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "transcript.jsonl"),
    opts.transcript.map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
  writeFileSync(
    join(storeDir, JSONL_LOCAL_AGENT_STORE_FILES.runs),
    opts.runs.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

function runRow(
  overrides: Record<string, unknown> & { runId: string; agentId: string },
): Record<string, unknown> {
  const now = overrides.updatedAt ?? 1;
  return {
    turnNumber: 1,
    status: "finished",
    createdAt: now,
    updatedAt: now,
    startCheckpointRef: null,
    latestCheckpointRef: null,
    ...overrides,
  };
}

describe("resolveForkPoint", () => {
  it("resolves a turn-boundary position to that turn's terminal checkpoint", async () => {
    const resolveForkPoint = await loadResolveForkPoint();
    writeConversation("conv-boundary", {
      transcript: [
        { type: "prompt", text: "go", at: AT_T1, seq: 1 },
        { type: "assistant", text: "done", at: AT_T1_END, seq: 2 },
      ],
      runs: [
        runRow({
          runId: "run-1",
          agentId: "agent-1",
          turnNumber: 1,
          startedAt: T1_MS,
          endedAt: T1_END_MS,
          latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-turn-1" },
        }),
      ],
    });

    expect(resolveForkPoint("conv-boundary", 2)).toEqual({
      runId: "run-1",
      rootBlobId: "chk-turn-1",
      turnNumber: 1,
    });
  });

  it("resolves a trailing event stamped after the run endedAt", async () => {
    const resolveForkPoint = await loadResolveForkPoint();
    writeConversation("conv-trailing", {
      transcript: [
        { type: "prompt", text: "go", at: AT_T1, seq: 1 },
        { type: "thinking", text: "wrap-up", at: AT_T1_TRAILING, seq: 2 },
      ],
      runs: [
        runRow({
          runId: "run-1",
          agentId: "agent-1",
          turnNumber: 1,
          startedAt: T1_MS,
          endedAt: T1_END_MS,
          latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-trailing" },
        }),
      ],
    });

    expect(resolveForkPoint("conv-trailing", 2)).toEqual({
      runId: "run-1",
      rootBlobId: "chk-trailing",
      turnNumber: 1,
    });
  });

  it("throws when the position is inside an in-flight run", async () => {
    const resolveForkPoint = await loadResolveForkPoint();
    writeConversation("conv-in-flight", {
      transcript: [
        { type: "prompt", text: "go", at: AT_T2, seq: 1 },
        { type: "assistant", text: "working", at: AT_T2_MID, seq: 2 },
      ],
      runs: [
        runRow({
          runId: "run-live",
          agentId: "agent-1",
          turnNumber: 2,
          status: "running",
          startedAt: T2_MS,
          latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-live" },
        }),
      ],
    });

    expect(() => resolveForkPoint("conv-in-flight", 2)).toThrow(
      /run "run-live" is still in flight \(running\)/,
    );
  });

  it("resolves to the run the position belongs to when one prompt produced two runs", async () => {
    const resolveForkPoint = await loadResolveForkPoint();
    writeConversation("conv-auth-recovery", {
      transcript: [
        { type: "prompt", text: "go", at: AT_T1, seq: 1 },
        { type: "assistant", text: "partial", at: AT_RECOVERY, seq: 2 },
        { type: "assistant", text: "finished", at: AT_T2_END, seq: 3 },
      ],
      runs: [
        runRow({
          runId: "run-first",
          agentId: "agent-1",
          turnNumber: 1,
          status: "cancelled",
          startedAt: T1_MS,
          endedAt: Date.parse(AT_RECOVERY),
          updatedAt: 1,
          latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-first" },
        }),
        runRow({
          runId: "run-recovery",
          agentId: "agent-1",
          turnNumber: 2,
          startedAt: T2_MS,
          endedAt: T2_END_MS,
          updatedAt: 2,
          latestCheckpointRef: { schemaVersion: 1, rootBlobId: "chk-recovery" },
        }),
      ],
    });

    expect(resolveForkPoint("conv-auth-recovery", 2)).toEqual({
      runId: "run-first",
      rootBlobId: "chk-first",
      turnNumber: 1,
    });
    expect(resolveForkPoint("conv-auth-recovery", 3)).toEqual({
      runId: "run-recovery",
      rootBlobId: "chk-recovery",
      turnNumber: 2,
    });
  });
});

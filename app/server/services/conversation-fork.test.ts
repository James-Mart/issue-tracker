import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Agent,
  JSONL_LOCAL_AGENT_STORE_FILES,
  JsonlLocalAgentStore,
} from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function loadCopyAgentState() {
  const mod = await import("./conversation-fork.js");
  return mod.copyAgentState;
}

const SOURCE_AGENT = "agent-source";
const FORK_AGENT = "agent-fork";
const FORK_CWD = "/tmp/fork-resume-workspace";
const CHECKPOINT_KEEP = { schemaVersion: 1 as const, rootBlobId: "chk-keep" };
const CHECKPOINT_DROP = { schemaVersion: 1 as const, rootBlobId: "chk-drop" };
const CHECKPOINT_PAYLOAD = new Uint8Array(32).fill(9);

function storeFileFingerprint(dir: string): Map<string, Buffer> {
  const files = Object.values(JSONL_LOCAL_AGENT_STORE_FILES);
  const fingerprint = new Map<string, Buffer>();
  for (const name of files) {
    const path = join(dir, name);
    if (existsSync(path)) fingerprint.set(name, readFileSync(path));
  }
  return fingerprint;
}

function readNdjsonLines(dir: string, name: string): Record<string, unknown>[] {
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function seedForkableStore(sourceDir: string): Promise<void> {
  mkdirSync(sourceDir, { recursive: true });
  const store = new JsonlLocalAgentStore(sourceDir);
  await store.agents.create({
    agent: {
      agentId: SOURCE_AGENT,
      cwd: FORK_CWD,
      status: "running",
      activeRunId: "run-2",
      createdAt: 1,
      updatedAt: 3,
      latestCheckpoint: CHECKPOINT_DROP,
    },
  });
  await store.checkpoints.create({
    agentId: SOURCE_AGENT,
    blobId: CHECKPOINT_KEEP.rootBlobId,
    data: CHECKPOINT_PAYLOAD,
  });
  await store.checkpoints.create({
    agentId: SOURCE_AGENT,
    blobId: CHECKPOINT_DROP.rootBlobId,
    data: new Uint8Array(8).fill(1),
  });
  await store.runs.create({
    run: {
      runId: "run-1",
      agentId: SOURCE_AGENT,
      turnNumber: 1,
      status: "finished",
      createdAt: 1,
      updatedAt: 1,
      latestCheckpointRef: CHECKPOINT_KEEP,
    },
  });
  await store.runs.create({
    run: {
      runId: "run-2",
      agentId: SOURCE_AGENT,
      turnNumber: 2,
      status: "running",
      createdAt: 2,
      updatedAt: 2,
      latestCheckpointRef: CHECKPOINT_DROP,
    },
  });
  await store.runEvents.append({
    runId: "run-1",
    eventType: "run_stream_event",
    payload: { kept: true },
  });
  await store.runEvents.append({
    runId: "run-2",
    eventType: "run_stream_event",
    payload: { drop: true },
  });
}

describe("copyAgentState", () => {
  it("copies a trimmed store under a fresh agent id that can resume", async () => {
    const copyAgentState = await loadCopyAgentState();
    const sourceDir = join(root, "source-store");
    const targetDir = join(root, "target-store");
    await seedForkableStore(sourceDir);
    const before = storeFileFingerprint(sourceDir);

    copyAgentState({
      sourceDir,
      targetDir,
      newAgentId: FORK_AGENT,
      keepRunId: "run-1",
    });

    expect(storeFileFingerprint(sourceDir)).toEqual(before);

    const agents = readNdjsonLines(
      targetDir,
      JSONL_LOCAL_AGENT_STORE_FILES.agents,
    );
    const runs = readNdjsonLines(targetDir, JSONL_LOCAL_AGENT_STORE_FILES.runs);
    const checkpoints = readNdjsonLines(
      targetDir,
      JSONL_LOCAL_AGENT_STORE_FILES.checkpoints,
    );
    const events = readNdjsonLines(
      targetDir,
      JSONL_LOCAL_AGENT_STORE_FILES.runEvents,
    );

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      agentId: FORK_AGENT,
      activeRunId: null,
      status: "idle",
      latestCheckpoint: CHECKPOINT_KEEP,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: "run-1",
      agentId: FORK_AGENT,
      latestCheckpointRef: CHECKPOINT_KEEP,
    });
    expect(checkpoints.every((row) => row.agentId === FORK_AGENT)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ runId: "run-1" });

    const handle = await Agent.resume(FORK_AGENT, {
      local: {
        cwd: FORK_CWD,
        store: new JsonlLocalAgentStore(targetDir),
      },
    });
    expect(handle.agentId).toBe(FORK_AGENT);
    await handle[Symbol.asyncDispose]();
  });
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Agent,
  JSONL_LOCAL_AGENT_STORE_FILES,
  JsonlLocalAgentStore,
} from "@cursor/sdk";
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

async function loadCopyAgentState() {
  const mod = await import("./conversation-fork.js");
  return mod.copyAgentState;
}

async function loadCopyInheritedHistory() {
  const mod = await import("./conversation-fork.js");
  return mod.copyInheritedHistory;
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

function conversationDir(id: string): string {
  return join(root, "conversations", id);
}

function conversationFingerprint(id: string): Map<string, Buffer> {
  const dir = conversationDir(id);
  const fingerprint = new Map<string, Buffer>();

  function walk(relDir: string): void {
    const abs = join(dir, relDir);
    if (!existsSync(abs)) return;
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const rel = relDir ? join(relDir, ent.name) : ent.name;
      const path = join(dir, rel);
      if (ent.isDirectory()) {
        walk(rel);
      } else if (ent.isFile()) {
        fingerprint.set(rel, readFileSync(path));
      }
    }
  }

  walk("");
  return fingerprint;
}

const SAMPLE_USAGE = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 15,
};

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

  it("ignores a trailing partial line in the source store", async () => {
    const copyAgentState = await loadCopyAgentState();
    const sourceDir = join(root, "partial-source");
    const targetDir = join(root, "partial-target");
    await seedForkableStore(sourceDir);

    const runsPath = join(sourceDir, JSONL_LOCAL_AGENT_STORE_FILES.runs);
    writeFileSync(
      runsPath,
      `${readFileSync(runsPath, "utf8")}{"runId":"run-live","agentId":"agent-source","turn`,
      "utf8",
    );

    expect(() =>
      copyAgentState({
        sourceDir,
        targetDir,
        newAgentId: FORK_AGENT,
        keepRunId: "run-1",
      }),
    ).not.toThrow();

    const runs = readNdjsonLines(targetDir, JSONL_LOCAL_AGENT_STORE_FILES.runs);
    expect(runs.map((row) => row.runId)).toEqual(["run-1"]);
  });
});

describe("copyInheritedHistory", () => {
  function writeInheritedSource(
    id: string,
    opts: {
      transcript: (TranscriptEvent | Record<string, unknown>)[];
      delegations?: Record<string, unknown>[];
      attachments?: Record<string, string>;
      nested?: Record<string, Record<string, string>>;
    },
  ): void {
    const dir = conversationDir(id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "meta.json"),
      `${JSON.stringify(
        {
          id,
          title: "Inherited copy test",
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
      join(dir, "delegations.jsonl"),
      (opts.delegations ?? [])
        .map((record) => JSON.stringify(record))
        .join("\n") + (opts.delegations?.length ? "\n" : ""),
    );

    if (opts.attachments) {
      const attachmentsDir = join(dir, "attachments");
      mkdirSync(attachmentsDir, { recursive: true });
      for (const [name, body] of Object.entries(opts.attachments)) {
        writeFileSync(join(attachmentsDir, name), body);
      }
    }

    if (opts.nested) {
      for (const [agentId, files] of Object.entries(opts.nested)) {
        const nestedDir = join(dir, "agent-state", "nested", agentId);
        mkdirSync(nestedDir, { recursive: true });
        for (const [name, body] of Object.entries(files)) {
          writeFileSync(join(nestedDir, name), body);
        }
      }
    }
  }

  function readTranscript(id: string): TranscriptEvent[] {
    const path = join(conversationDir(id), "transcript.jsonl");
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as TranscriptEvent);
  }

  it("copies transcript through the fork position including trailing usage", async () => {
    const copyInheritedHistory = await loadCopyInheritedHistory();
    writeInheritedSource("conv-source", {
      transcript: [
        { type: "prompt", text: "go", at: AT_T1, seq: 1 },
        { type: "assistant", text: "done", at: AT_T1_END, seq: 2 },
        { type: "usage", usage: SAMPLE_USAGE, at: AT_T1_TRAILING, seq: 3 },
        { type: "prompt", text: "later", at: AT_T2, seq: 4 },
      ],
    });
    mkdirSync(conversationDir("conv-fork"), { recursive: true });
    const before = conversationFingerprint("conv-source");

    copyInheritedHistory({
      sourceId: "conv-source",
      targetId: "conv-fork",
      forkedAtSeq: 3,
    });

    expect(conversationFingerprint("conv-source")).toEqual(before);
    const copied = readTranscript("conv-fork");
    expect(copied.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(copied.at(-1)).toMatchObject({
      type: "usage",
      at: AT_T1_TRAILING,
    });
  });

  it("keeps legacy transcript lines by line order when seq is absent", async () => {
    const copyInheritedHistory = await loadCopyInheritedHistory();
    writeInheritedSource("conv-legacy", {
      transcript: [
        { type: "prompt", text: "go", at: AT_T1, seq: 1 },
        { type: "assistant", text: "legacy", at: AT_T1_END },
        { type: "usage", usage: SAMPLE_USAGE, at: AT_T1_TRAILING, seq: 3 },
        { type: "prompt", text: "drop", at: AT_T2, seq: 4 },
      ],
    });
    mkdirSync(conversationDir("conv-legacy-fork"), { recursive: true });

    copyInheritedHistory({
      sourceId: "conv-legacy",
      targetId: "conv-legacy-fork",
      forkedAtSeq: 3,
    });

    const copied = readTranscript("conv-legacy-fork");
    expect(copied).toHaveLength(3);
    expect(copied[1]).toMatchObject({
      type: "assistant",
      text: "legacy",
      at: AT_T1_END,
    });
  });

  it("copies kept delegations, their nested stores, and prompt attachments only", async () => {
    const copyInheritedHistory = await loadCopyInheritedHistory();
    writeInheritedSource("conv-inherit", {
      transcript: [
        {
          type: "prompt",
          text: "with file",
          at: AT_T1,
          seq: 1,
          attachments: ["keep.png"],
        },
        { type: "assistant", text: "ok", at: AT_T1_END, seq: 2 },
        { type: "usage", usage: SAMPLE_USAGE, at: AT_T1_TRAILING, seq: 3 },
        {
          type: "prompt",
          text: "later file",
          at: AT_T2,
          seq: 4,
          attachments: ["drop.png"],
        },
      ],
      delegations: [
        {
          delegationId: "del-keep",
          agentId: "nested-keep",
          role: "worker",
          model: "composer-2.5",
          lifecycle: "tracked",
          at: AT_T1,
        },
        {
          delegationId: "del-drop",
          agentId: "nested-drop",
          role: "worker",
          model: "composer-2.5",
          lifecycle: "tracked",
          at: AT_T2,
        },
      ],
      attachments: {
        "keep.png": "kept-bytes",
        "drop.png": "dropped-bytes",
      },
      nested: {
        "nested-keep": { "agents.ndjson": '{"agentId":"nested-keep"}\n' },
        "nested-drop": { "agents.ndjson": '{"agentId":"nested-drop"}\n' },
      },
    });
    mkdirSync(conversationDir("conv-inherit-fork"), { recursive: true });
    const before = conversationFingerprint("conv-inherit");

    copyInheritedHistory({
      sourceId: "conv-inherit",
      targetId: "conv-inherit-fork",
      forkedAtSeq: 3,
    });

    expect(conversationFingerprint("conv-inherit")).toEqual(before);

    const delegations = readFileSync(
      join(conversationDir("conv-inherit-fork"), "delegations.jsonl"),
      "utf8",
    );
    expect(delegations).toContain("nested-keep");
    expect(delegations).not.toContain("nested-drop");

    const keptNested = join(
      conversationDir("conv-inherit-fork"),
      "agent-state",
      "nested",
      "nested-keep",
      "agents.ndjson",
    );
    expect(readFileSync(keptNested, "utf8")).toContain("nested-keep");
    expect(
      existsSync(
        join(
          conversationDir("conv-inherit-fork"),
          "agent-state",
          "nested",
          "nested-drop",
        ),
      ),
    ).toBe(false);

    expect(
      readFileSync(
        join(conversationDir("conv-inherit-fork"), "attachments", "keep.png"),
      ).toString(),
    ).toBe("kept-bytes");
    expect(
      existsSync(
        join(conversationDir("conv-inherit-fork"), "attachments", "drop.png"),
      ),
    ).toBe(false);
  });
});

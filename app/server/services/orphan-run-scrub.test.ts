import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "../schemas.js";
import {
  issuesRoot,
  load,
  runLiveMarkerPath,
  useAgentSessionsTestFixtures,
} from "./agent-sessions.test-harness.js";

useAgentSessionsTestFixtures();

const AT = "2026-01-01T00:00:00.000Z";
const TOOL_MESSAGE = "Host process died before this tool finished.";
const RECOVERY_MESSAGE =
  "The previous turn was cut off because the host process died.";
function readProcStartTime(pid: number = process.pid): number {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const startTime = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  if (!startTime) throw new Error(`unparseable /proc/${pid}/stat`);
  return Number(startTime);
}

async function deadPid(): Promise<number> {
  const child = spawn("true", [], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("expected spawned pid");
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  return pid;
}

function conversationDir(id: string): string {
  return join(dirname(issuesRoot), "conversations", id);
}

function storeDir(id: string, nestedAgentId?: string): string {
  const root = join(conversationDir(id), "agent-state");
  return nestedAgentId ? join(root, "nested", nestedAgentId) : root;
}

function writeNdjson(dir: string, name: string, rows: unknown[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}

function readNdjson(dir: string, name: string): Record<string, unknown>[] {
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function writeMarker(id: string, body: unknown): void {
  writeFileSync(runLiveMarkerPath(id), `${JSON.stringify(body)}\n`);
}

function writeTranscript(id: string, events: unknown[]): void {
  writeFileSync(
    join(conversationDir(id), "transcript.jsonl"),
    events.length === 0
      ? ""
      : `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

function agentRow(
  agentId: string,
  activeRunId: string | null,
  status = "running",
): Record<string, unknown> {
  return {
    agentId,
    cwd: "/tmp/workspace",
    status,
    activeRunId,
    createdAt: 1,
    updatedAt: 1,
  };
}

function runRow(
  runId: string,
  agentId: string,
  status: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    runId,
    agentId,
    turnNumber: 1,
    status,
    createdAt: 1,
    updatedAt: 1,
    ...extras,
  };
}

function cutOffTranscript(): unknown[] {
  return [
    { type: "prompt", text: "go", at: AT, seq: 1 },
    {
      type: "tool_call",
      at: AT,
      seq: 2,
      callId: "call-read",
      name: "Read",
      status: "running",
      args: { path: "a.ts" },
    },
    {
      type: "tool_call",
      at: AT,
      seq: 3,
      callId: "call-unnamed",
      status: "running",
    },
    {
      type: "tool_call",
      at: AT,
      seq: 4,
      callId: "call-done",
      name: "Grep",
      status: "completed",
      result: { status: "ok" },
    },
    {
      type: "subagent_update",
      at: AT,
      seq: 5,
      parentCallId: "call-parent",
      delegationId: "del-child",
      parentDelegationId: "del-parent",
      step: {
        kind: "tool_call",
        callId: "call-nested",
        name: "Shell",
        status: "running",
        args: { command: "ls" },
      },
    },
    {
      type: "subagent_update",
      at: AT,
      seq: 6,
      parentCallId: "call-parent",
      step: {
        kind: "tool_call",
        callId: "call-nested-plain",
        status: "running",
      },
    },
    {
      type: "subagent_update",
      at: AT,
      seq: 7,
      parentCallId: "call-parent",
      delegationId: "del-child",
      step: {
        kind: "tool_call",
        callId: "call-nested-done",
        name: "Read",
        status: "completed",
      },
    },
  ];
}

async function createConversation(title: string): Promise<string> {
  const { createConversation: create } = await load();
  const meta = await create({
    title,
    projectId: "platform",
    model: "auto",
  });
  return meta.id;
}

function seedStores(
  id: string,
  runs: Record<string, unknown>[],
  nestedRuns: Record<string, unknown>[] = runs,
): { parent: string; nested: string } {
  const parent = storeDir(id);
  const nested = storeDir(id, "nested-agent");
  writeNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.agents, [
    agentRow("agent-parent", "run-open"),
  ]);
  writeNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs, runs);
  writeNdjson(nested, JSONL_LOCAL_AGENT_STORE_FILES.agents, [
    agentRow("nested-agent", "run-open"),
  ]);
  writeNdjson(nested, JSONL_LOCAL_AGENT_STORE_FILES.runs, nestedRuns);
  return { parent, nested };
}

async function seedCutOff(title: string): Promise<{
  id: string;
  parent: string;
  nested: string;
}> {
  const id = await createConversation(title);
  const stores = seedStores(id, [
    runRow("run-done", "agent-parent", "finished"),
    runRow("run-open", "agent-parent", "running"),
  ]);
  writeTranscript(id, cutOffTranscript());
  return { id, ...stores };
}

async function loadScrub() {
  return import("./orphan-run-scrub.js");
}

async function transcriptOf(id: string): Promise<TranscriptEvent[]> {
  const { readConversation } = await load();
  return (await readConversation(id)).transcript;
}

function recoveryEvents(events: readonly TranscriptEvent[]): TranscriptEvent[] {
  return events.filter((event) => event.type === "host_crash_recovery");
}

async function expectScrubbed(id: string, parent: string, nested: string): Promise<void> {
  const events = await transcriptOf(id);
  const toolErrors = events.filter(
    (event): event is Extract<TranscriptEvent, { type: "tool_call" }> =>
      event.type === "tool_call" && event.status === "error",
  );
  expect(toolErrors.map((event) => event.callId)).toEqual([
    "call-read",
    "call-unnamed",
  ]);
  const named = toolErrors[0];
  const unnamed = toolErrors[1];
  if (named?.type !== "tool_call" || unnamed?.type !== "tool_call") {
    throw new Error("expected tool error events");
  }
  expect(named).toMatchObject({
    callId: "call-read",
    name: "Read",
    status: "error",
    result: { status: "error", message: TOOL_MESSAGE },
  });
  expect(named).not.toHaveProperty("args");
  expect(unnamed).toMatchObject({
    callId: "call-unnamed",
    status: "error",
    result: { status: "error", message: TOOL_MESSAGE },
  });
  expect(unnamed).not.toHaveProperty("name");

  const nestedErrors = events.filter(
    (event) =>
      event.type === "subagent_update" &&
      event.step.kind === "tool_call" &&
      event.step.status === "error",
  );
  expect(nestedErrors).toHaveLength(2);
  expect(nestedErrors[0]).toMatchObject({
    parentCallId: "call-parent",
    delegationId: "del-child",
    parentDelegationId: "del-parent",
    step: {
      kind: "tool_call",
      callId: "call-nested",
      name: "Shell",
      status: "error",
      result: { status: "error", message: TOOL_MESSAGE },
    },
  });
  const nestedStep = nestedErrors[0];
  if (
    nestedStep?.type === "subagent_update" &&
    nestedStep.step.kind === "tool_call"
  ) {
    expect(nestedStep.step).not.toHaveProperty("args");
  }
  if (nestedErrors[1]?.type !== "subagent_update") {
    throw new Error("expected nested tool error");
  }
  expect(nestedErrors[1]).toMatchObject({
    parentCallId: "call-parent",
    step: {
      kind: "tool_call",
      callId: "call-nested-plain",
      status: "error",
      result: { status: "error", message: TOOL_MESSAGE },
    },
  });
  expect(nestedErrors[1]).not.toHaveProperty("delegationId");
  expect(nestedErrors[1]).not.toHaveProperty("parentDelegationId");
  if (nestedErrors[1].step.kind === "tool_call") {
    expect(nestedErrors[1].step).not.toHaveProperty("name");
  }

  const recoveries = recoveryEvents(events);
  expect(recoveries).toHaveLength(1);
  expect(recoveries[0]).toMatchObject({
    type: "host_crash_recovery",
    message: RECOVERY_MESSAGE,
  });

  for (const dir of [parent, nested]) {
    const runs = readNdjson(dir, JSONL_LOCAL_AGENT_STORE_FILES.runs);
    const open = runs.find((row) => row.runId === "run-open");
    const done = runs.find((row) => row.runId === "run-done");
    expect(open).toMatchObject({
      status: "error",
      error: "host_process_died",
    });
    expect(typeof open?.endedAt).toBe("number");
    expect(done).toMatchObject({ status: "finished" });
    expect(done).not.toHaveProperty("error");
    expect(readNdjson(dir, JSONL_LOCAL_AGENT_STORE_FILES.agents)[0]).toMatchObject({
      status: "idle",
      activeRunId: null,
    });
  }
  expect(existsSync(runLiveMarkerPath(id))).toBe(false);
  expect(existsSync(join(conversationDir(id), "reconcile.lock"))).toBe(false);
}

describe("reconcileOrphanedConversation", () => {
  it("scrubs a dead-pid marker across parent and nested stores", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const { id, parent, nested } = await seedCutOff("Dead pid");
    const pid = await deadPid();
    writeFileSync(
      join(conversationDir(id), "reconcile.lock"),
      `${JSON.stringify({ pid: 2 ** 30 })}\n`,
    );
    writeMarker(id, { pid });

    const before = Date.now();
    await reconcileOrphanedConversation(id);
    const after = Date.now();

    await expectScrubbed(id, parent, nested);
    const endedAt = readNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs).find(
      (row) => row.runId === "run-open",
    )?.endedAt;
    expect(endedAt).toBeGreaterThanOrEqual(before);
    expect(endedAt).toBeLessThanOrEqual(after);
  });

  it("scrubs a recycled pid whose start time does not match", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const { id, parent, nested } = await seedCutOff("Recycled pid");
    writeMarker(id, {
      pid: process.pid,
      bootId: "previous-boot",
      processStartedAt: readProcStartTime() - 1,
    });

    await reconcileOrphanedConversation(id);
    await expectScrubbed(id, parent, nested);
  });

  it("leaves a live pid alone when the start time matches, even with another bootId", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const { id, parent } = await seedCutOff("Live other boot");
    writeMarker(id, {
      pid: process.pid,
      bootId: "previous-boot",
      processStartedAt: readProcStartTime(),
    });
    const runs = readFileSync(
      join(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs),
      "utf8",
    );
    const transcript = readFileSync(
      join(conversationDir(id), "transcript.jsonl"),
      "utf8",
    );

    await reconcileOrphanedConversation(id);

    expect(
      readFileSync(join(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs), "utf8"),
    ).toBe(runs);
    expect(readFileSync(join(conversationDir(id), "transcript.jsonl"), "utf8")).toBe(
      transcript,
    );
    expect(existsSync(runLiveMarkerPath(id))).toBe(true);
    expect(recoveryEvents(await transcriptOf(id))).toHaveLength(0);
  });

  it("leaves a legacy live pid alone", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const { id, parent } = await seedCutOff("Legacy live");
    writeMarker(id, { pid: process.pid });
    const runs = readFileSync(
      join(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs),
      "utf8",
    );

    await reconcileOrphanedConversation(id);

    expect(
      readFileSync(join(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs), "utf8"),
    ).toBe(runs);
    expect(existsSync(runLiveMarkerPath(id))).toBe(true);
    expect(recoveryEvents(await transcriptOf(id))).toHaveLength(0);
  });

  it("leaves a running SDK run alone when the conversation has no marker", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const { id, parent } = await seedCutOff("No marker");
    const runs = readFileSync(
      join(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs),
      "utf8",
    );

    await reconcileOrphanedConversation(id);

    expect(
      readFileSync(join(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs), "utf8"),
    ).toBe(runs);
    expect(existsSync(runLiveMarkerPath(id))).toBe(false);
    expect(recoveryEvents(await transcriptOf(id))).toHaveLength(0);
  });

  it("deletes the marker and appends no recovery when runs are already terminal", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const id = await createConversation("Already terminal");
    const statuses = ["finished", "error", "cancelled", "expired"] as const;
    const parent = storeDir(id);
    const nested = storeDir(id, "nested-agent");
    const runs = statuses.map((status, index) =>
      runRow(`run-${status}`, "agent-parent", status, {
        ...(status === "error" ? { error: "earlier" } : {}),
        turnNumber: index + 1,
      }),
    );
    writeNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.agents, [
      agentRow("agent-parent", "run-finished", "running"),
    ]);
    writeNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs, runs);
    writeNdjson(nested, JSONL_LOCAL_AGENT_STORE_FILES.agents, [
      agentRow("nested-agent", "run-finished", "running"),
    ]);
    writeNdjson(nested, JSONL_LOCAL_AGENT_STORE_FILES.runs, runs);
    writeTranscript(id, [
      {
        type: "tool_call",
        at: AT,
        callId: "call-done",
        name: "Read",
        status: "completed",
      },
    ]);
    const pid = await deadPid();
    writeMarker(id, { pid });

    await reconcileOrphanedConversation(id);

    expect(existsSync(runLiveMarkerPath(id))).toBe(false);
    expect(recoveryEvents(await transcriptOf(id))).toHaveLength(0);
    for (const dir of [parent, nested]) {
      expect(readNdjson(dir, JSONL_LOCAL_AGENT_STORE_FILES.runs)).toEqual(runs);
      expect(readNdjson(dir, JSONL_LOCAL_AGENT_STORE_FILES.agents)[0]).toMatchObject({
        status: "idle",
        activeRunId: null,
      });
    }
  });

  it("closes a running tool chip when runs are already terminal", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const id = await createConversation("Tool only");
    const parent = storeDir(id);
    writeNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.agents, [
      agentRow("agent-parent", null, "idle"),
    ]);
    writeNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs, [
      runRow("run-done", "agent-parent", "finished"),
    ]);
    writeTranscript(id, [
      {
        type: "tool_call",
        at: AT,
        callId: "call-read",
        name: "Read",
        status: "running",
      },
    ]);
    const pid = await deadPid();
    writeMarker(id, { pid });

    await reconcileOrphanedConversation(id);

    const events = await transcriptOf(id);
    expect(events.filter((event) => event.type === "tool_call")).toEqual([
      expect.objectContaining({ callId: "call-read", status: "running" }),
      expect.objectContaining({
        callId: "call-read",
        name: "Read",
        status: "error",
        result: { status: "error", message: TOOL_MESSAGE },
      }),
    ]);
    expect(recoveryEvents(events)).toEqual([
      expect.objectContaining({ message: RECOVERY_MESSAGE }),
    ]);
    expect(
      readNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs)[0],
    ).toMatchObject({ status: "finished" });
    expect(existsSync(runLiveMarkerPath(id))).toBe(false);
  });

  it("does not append a second recovery line when one is already stored", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const id = await createConversation("Recovery already stored");
    const parent = storeDir(id);
    writeNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs, [
      runRow("run-open", "agent-parent", "running"),
    ]);
    writeNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.agents, [
      agentRow("agent-parent", "run-open"),
    ]);
    writeTranscript(id, [
      {
        type: "tool_call",
        at: AT,
        callId: "call-read",
        name: "Read",
        status: "running",
      },
      {
        type: "host_crash_recovery",
        at: AT,
        message: RECOVERY_MESSAGE,
      },
    ]);
    const pid = await deadPid();
    writeMarker(id, { pid });

    await reconcileOrphanedConversation(id);

    const events = await transcriptOf(id);
    expect(recoveryEvents(events)).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.type === "tool_call" && event.status === "error",
      ),
    ).toHaveLength(1);
    expect(existsSync(runLiveMarkerPath(id))).toBe(false);
  });

  it("keeps the marker and omits the recovery line when a store write fails", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const { id, parent } = await seedCutOff("Write fails");
    const pid = await deadPid();
    writeMarker(id, { pid });
    const runsPath = join(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs);
    mkdirSync(`${runsPath}.${process.pid}.scrub-tmp`);

    await expect(reconcileOrphanedConversation(id)).rejects.toThrow(/EISDIR|illegal operation/i);

    expect(existsSync(runLiveMarkerPath(id))).toBe(true);
    expect(recoveryEvents(await transcriptOf(id))).toHaveLength(0);
    expect(
      readNdjson(parent, JSONL_LOCAL_AGENT_STORE_FILES.runs).find(
        (row) => row.runId === "run-open",
      ),
    ).toMatchObject({ status: "running" });
    expect(existsSync(join(conversationDir(id), "reconcile.lock"))).toBe(false);
  });

  it("appends the recovery line once when two reconciles overlap", async () => {
    const { reconcileOrphanedConversation } = await loadScrub();
    const { id } = await seedCutOff("Overlap");
    const pid = await deadPid();
    writeMarker(id, { pid });
    const lock = join(conversationDir(id), "reconcile.lock");
    writeFileSync(lock, `${JSON.stringify({ pid: process.pid })}\n`);

    const pending = Promise.all([
      reconcileOrphanedConversation(id),
      reconcileOrphanedConversation(id),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    rmSync(lock);
    await pending;

    expect(recoveryEvents(await transcriptOf(id))).toHaveLength(1);
    expect(existsSync(runLiveMarkerPath(id))).toBe(false);
  });
});

describe("scrubOrphanedRunsAtBoot", () => {
  it("logs one failed conversation and still scrubs the rest", async () => {
    const { scrubOrphanedRunsAtBoot } = await loadScrub();
    const badId = await createConversation("Broken store");
    const good = await seedCutOff("Good orphan");
    const pid = await deadPid();
    writeMarker(badId, { pid });
    writeMarker(good.id, { pid });
    const badStore = storeDir(badId);
    mkdirSync(badStore, { recursive: true });
    writeFileSync(
      join(badStore, JSONL_LOCAL_AGENT_STORE_FILES.runs),
      "not-json\n",
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(scrubOrphanedRunsAtBoot()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(badId),
      expect.anything(),
    );
    expect(existsSync(runLiveMarkerPath(badId))).toBe(true);
    expect(recoveryEvents(await transcriptOf(badId))).toHaveLength(0);
    await expectScrubbed(good.id, good.parent, good.nested);
    error.mockRestore();
  });
});

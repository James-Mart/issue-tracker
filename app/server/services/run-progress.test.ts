import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSONL_LOCAL_AGENT_STORE_FILES } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { turnMadeProgress } from "./run-progress.js";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";

let storeDir: string;
const dirs: string[] = [];

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "run-progress-"));
  dirs.push(storeDir);
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runsFile(dir: string): string {
  return join(dir, JSONL_LOCAL_AGENT_STORE_FILES.runs);
}

function writeRuns(
  dir: string,
  rows: Record<string, unknown>[],
): void {
  writeFileSync(
    runsFile(dir),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
}

function runRow(
  overrides: Record<string, unknown> & { runId: string; agentId: string },
): Record<string, unknown> {
  const now = overrides.updatedAt ?? 1;
  return {
    turnNumber: 1,
    status: "cancelled",
    createdAt: now,
    updatedAt: now,
    startCheckpointRef: null,
    latestCheckpointRef: null,
    ...overrides,
  };
}

describe("turnMadeProgress", () => {
  it("reports progress when checkpoint rootBlobId values differ", async () => {
    writeRuns(storeDir, [
      runRow({
        runId: "run-1",
        agentId: AGENT_A,
        startCheckpointRef: { schemaVersion: 1, rootBlobId: "start" },
        latestCheckpointRef: { schemaVersion: 1, rootBlobId: "latest" },
      }),
    ]);

    expect(await turnMadeProgress(storeDir, AGENT_A)).toBe(true);
  });

  it("reports no progress when checkpoint rootBlobId values match", async () => {
    writeRuns(storeDir, [
      runRow({
        runId: "run-1",
        agentId: AGENT_A,
        startCheckpointRef: { schemaVersion: 1, rootBlobId: "same" },
        latestCheckpointRef: { schemaVersion: 1, rootBlobId: "same" },
      }),
    ]);

    expect(await turnMadeProgress(storeDir, AGENT_A)).toBe(false);
  });

  it("reports no progress when both checkpoint refs are absent", async () => {
    writeRuns(storeDir, [
      runRow({
        runId: "run-1",
        agentId: AGENT_A,
        startCheckpointRef: null,
        latestCheckpointRef: null,
      }),
    ]);

    expect(await turnMadeProgress(storeDir, AGENT_A)).toBe(false);
  });

  it("reports no progress when runs.ndjson is missing", async () => {
    expect(await turnMadeProgress(storeDir, AGENT_A)).toBe(false);
  });

  it("uses the newest record when one agent has several runs", async () => {
    writeRuns(storeDir, [
      runRow({
        runId: "run-old",
        agentId: AGENT_A,
        updatedAt: 1,
        startCheckpointRef: { schemaVersion: 1, rootBlobId: "a" },
        latestCheckpointRef: { schemaVersion: 1, rootBlobId: "b" },
      }),
      runRow({
        runId: "run-new",
        agentId: AGENT_A,
        updatedAt: 2,
        startCheckpointRef: { schemaVersion: 1, rootBlobId: "same" },
        latestCheckpointRef: { schemaVersion: 1, rootBlobId: "same" },
      }),
      runRow({
        runId: "run-other-agent",
        agentId: AGENT_B,
        updatedAt: 3,
        startCheckpointRef: { schemaVersion: 1, rootBlobId: "x" },
        latestCheckpointRef: { schemaVersion: 1, rootBlobId: "y" },
      }),
    ]);

    expect(await turnMadeProgress(storeDir, AGENT_A)).toBe(false);
    expect(await turnMadeProgress(storeDir, AGENT_B)).toBe(true);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-24T12:00:00.000Z";

let root: string;
let issuesDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-transcript-seq-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function writeTranscript(id: string, body: string): void {
  mkdirSync(join(root, "conversations", id), { recursive: true });
  writeFileSync(join(root, "conversations", id, "transcript.jsonl"), body);
}

function stamped(seq: number, text: string): string {
  return JSON.stringify({ type: "assistant", text, at: AT, seq });
}

async function loadTranscriptSeq() {
  return import("./conversation-transcript-seq.js");
}

describe("maxSeqFromTranscriptTail", () => {

  it("uses the last stamped line when the tail is torn or blank", async () => {
    writeTranscript(
      "torn",
      `${stamped(4, "kept")}\n${stamped(7, "last")}\n{"type":"assistant"`,
    );
    writeTranscript("blank", `${stamped(3, "only")}\n\n`);
    const { maxSeqFromTranscriptTail, maxSeqFromTranscriptFile } =
      await loadTranscriptSeq();
    const torn = maxSeqFromTranscriptTail("torn");
    expect(torn).toBe(maxSeqFromTranscriptFile("torn"));
    expect(torn).toBe(7);
    expect(maxSeqFromTranscriptTail("blank")).toBe(3);
    expect(maxSeqFromTranscriptTail("missing")).toBe(0);
    writeTranscript("empty", "");
    expect(maxSeqFromTranscriptTail("empty")).toBe(0);
  });
});

describe("legacy run_cost lines", () => {
  it("skips run_cost on load without dropping other events", async () => {
    const usage = JSON.stringify({
      type: "usage",
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 12,
      },
      at: AT,
      seq: 2,
    });
    const legacyCost = JSON.stringify({
      type: "run_cost",
      runId: "run-1",
      agentId: "agent-1",
      status: "settled",
      at: AT,
      seq: 3,
      cost: { rawCostCents: 5, chargedCents: 5 },
    });
    writeTranscript("legacy", `${stamped(1, "hi")}\n${usage}\n${legacyCost}`);
    const { readAllTranscriptEvents } = await loadTranscriptSeq();
    const events = readAllTranscriptEvents("legacy");
    expect(events.map((e) => e.type)).toEqual(["assistant", "usage"]);
  });
});

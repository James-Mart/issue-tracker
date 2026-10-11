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

describe("maxSeqFromTranscriptTail", () => {
  async function loadTail() {
    return import("./conversation-transcript-seq.js");
  }

  it("uses the last stamped line when the tail is torn or blank", async () => {
    writeTranscript(
      "torn",
      `${stamped(4, "kept")}\n${stamped(7, "last")}\n{"type":"assistant"`,
    );
    writeTranscript("blank", `${stamped(3, "only")}\n\n`);
    const { maxSeqFromTranscriptTail, maxSeqFromTranscriptFile } = await loadTail();
    const torn = maxSeqFromTranscriptTail("torn");
    expect(torn).toBe(maxSeqFromTranscriptFile("torn"));
    expect(torn).toBe(7);
    expect(maxSeqFromTranscriptTail("blank")).toBe(3);
    expect(maxSeqFromTranscriptTail("missing")).toBe(0);
    writeTranscript("empty", "");
    expect(maxSeqFromTranscriptTail("empty")).toBe(0);
  });
});

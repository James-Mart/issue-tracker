import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "../schemas.js";
import type { readTranscriptPage as ReadTranscriptPage } from "./transcript-page.js";

const io = vi.hoisted(() => ({ bytes: 0, fullBytes: 0, armed: false }));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const readSync = ((...args: unknown[]) => {
    if (io.armed && typeof args[3] === "number") io.bytes += args[3];
    return (actual.readSync as (...forwarded: unknown[]) => number)(...args);
  }) as typeof actual.readSync;
  const readFileSync = ((...args: unknown[]) => {
    const result = (actual.readFileSync as (...forwarded: unknown[]) => unknown)(
      ...args,
    );
    if (
      io.armed &&
      typeof args[0] === "string" &&
      args[0].endsWith("transcript.jsonl")
    ) {
      io.fullBytes +=
        typeof result === "string" ? result.length : (result as Buffer).length;
    }
    return result;
  }) as typeof actual.readFileSync;
  return { ...actual, readSync, readFileSync };
});

function textOf(event: TranscriptEvent): string | undefined {
  return "text" in event ? event.text : undefined;
}

const AT = "2026-07-24T12:00:00.000Z";

let root: string;
let issuesDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-transcript-page-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  io.armed = false;
  io.bytes = 0;
  io.fullBytes = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function transcriptPath(id: string): string {
  return join(root, "conversations", id, "transcript.jsonl");
}

function writeTranscript(id: string, body: string): void {
  const path = transcriptPath(id);
  mkdirSync(join(root, "conversations", id), { recursive: true });
  writeFileSync(path, body);
}

function stamped(seq: number, text = `e${seq}`): string {
  return JSON.stringify({ type: "assistant", text, at: AT, seq });
}

function linesOf(seqs: number[], textFor?: (seq: number) => string): string {
  return `${seqs.map((seq) => stamped(seq, textFor?.(seq) ?? `e${seq}`)).join("\n")}\n`;
}

async function load(): Promise<{ readTranscriptPage: typeof ReadTranscriptPage }> {
  return import("./transcript-page.js");
}

describe("readTranscriptPage", () => {
  it("returns an empty page when the transcript is missing or empty", async () => {
    const { readTranscriptPage } = await load();
    expect(readTranscriptPage("gone", { limit: 10 })).toEqual({
      events: [],
      latestSeq: 0,
      hasMore: false,
    });
    writeTranscript("empty", "");
    expect(readTranscriptPage("empty", { limit: 10 })).toEqual({
      events: [],
      latestSeq: 0,
      hasMore: false,
    });
  });

  it("pages every before and limit against a stamped transcript", async () => {
    const seqs = Array.from({ length: 12 }, (_, i) => i + 1);
    writeTranscript("c", linesOf(seqs));
    const { readTranscriptPage } = await load();
    const befores: Array<number | undefined> = [undefined, 1, 2, 5, 12, 13, 100];
    for (const limit of [1, 2, 3, 5, 12, 20]) {
      for (const before of befores) {
        const page = readTranscriptPage(
          "c",
          before === undefined ? { limit } : { before, limit },
        );
        const eligible =
          before === undefined ? seqs : seqs.filter((seq) => seq < before);
        const label = `before=${String(before)} limit=${limit}`;
        expect(page.latestSeq, label).toBe(12);
        expect(page.hasMore, label).toBe(eligible.length > limit);
        expect(page.events.map((event) => event.seq), label).toEqual(
          eligible.slice(-limit),
        );
      }
    }
  });

  it("skips malformed lines and keeps seq gaps", async () => {
    writeTranscript(
      "c",
      [
        stamped(1, "one"),
        "not-json",
        JSON.stringify({ type: "nope", at: AT, seq: 9 }),
        stamped(2, "two"),
        stamped(4, "four"),
        "",
      ].join("\n"),
    );
    const { readTranscriptPage } = await load();
    const newest = readTranscriptPage("c", { limit: 2 });
    expect(newest.latestSeq).toBe(4);
    expect(newest.hasMore).toBe(true);
    expect(newest.events.map(textOf)).toEqual(["two", "four"]);

    const older = readTranscriptPage("c", { before: 4, limit: 10 });
    expect(older).toMatchObject({ latestSeq: 4, hasMore: false });
    expect(older.events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("numbers unstamped lines in file order and still pages from the newest end", async () => {
    const unstamped = (text: string) =>
      JSON.stringify({ type: "assistant", text, at: AT });
    writeTranscript(
      "c",
      [unstamped("a"), unstamped("b"), unstamped("c"), "bad", unstamped("d")].join(
        "\n",
      ) + "\n",
    );
    const { readTranscriptPage } = await load();
    const newest = readTranscriptPage("c", { limit: 2 });
    expect(newest.latestSeq).toBe(5);
    expect(newest.hasMore).toBe(true);
    expect(newest.events.map((event) => event.seq)).toEqual([3, 5]);
    expect(newest.events.map(textOf)).toEqual(["c", "d"]);

    const older = readTranscriptPage("c", { before: 3, limit: 10 });
    expect(older.hasMore).toBe(false);
    expect(older.latestSeq).toBe(5);
    expect(older.events.map((event) => ({ seq: event.seq, text: textOf(event) }))).toEqual([
      { seq: 1, text: "a" },
      { seq: 2, text: "b" },
    ]);
  });

  it("reads events that span read chunks, including a file with no trailing newline", async () => {
    writeTranscript(
      "wide",
      linesOf([1, 2, 3, 4, 5, 6], () => "z".repeat(5000)),
    );
    const path = transcriptPath("plain");
    mkdirSync(join(root, "conversations", "plain"), { recursive: true });
    writeFileSync(path, `${stamped(1, "héllo 你好")}\n${stamped(2, "tail")}`);
    const { readTranscriptPage } = await load();

    const wide = readTranscriptPage("wide", { before: 5, limit: 2 });
    expect(wide.latestSeq).toBe(6);
    expect(wide.hasMore).toBe(true);
    expect(wide.events.map((event) => event.seq)).toEqual([3, 4]);

    const plain = readTranscriptPage("plain", { limit: 10 });
    expect(plain.hasMore).toBe(false);
    expect(plain.latestSeq).toBe(2);
    expect(plain.events.map(textOf)).toEqual(["héllo 你好", "tail"]);
  });

  it("reads a page from the tail of a long transcript", async () => {
    const count = 4000;
    writeTranscript(
      "long",
      linesOf(
        Array.from({ length: count }, (_, i) => i + 1),
        () => "y".repeat(80),
      ),
    );
    const fileSize = statSync(transcriptPath("long")).size;

    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    const seq = await import("./conversation-transcript-seq.js");
    vi.spyOn(seq, "readAllTranscriptEvents").mockImplementation(() => {
      throw new Error("full transcript read");
    });
    const { readTranscriptPage } = await import("./transcript-page.js");

    const readPage = (
      options: { before?: number; limit: number },
    ): ReturnType<typeof readTranscriptPage> => {
      io.bytes = 0;
      io.armed = true;
      return readTranscriptPage("long", options);
    };

    const newest = readPage({ limit: 5 });
    expect(newest.events.map((event) => event.seq)).toEqual([
      3996, 3997, 3998, 3999, 4000,
    ]);
    expect(newest.hasMore).toBe(true);
    expect(newest.latestSeq).toBe(4000);
    expect(io.bytes).toBeGreaterThan(0);
    expect(io.bytes).toBeLessThan(fileSize / 10);

    const middle = readPage({ before: 2000, limit: 5 });
    expect(middle.events.map((event) => event.seq)).toEqual([
      1995, 1996, 1997, 1998, 1999,
    ]);
    expect(middle.hasMore).toBe(true);
    expect(middle.latestSeq).toBe(4000);
    expect(io.bytes).toBeLessThan(fileSize / 2);

    const early = readPage({ before: 3, limit: 5 });
    expect(early.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(early.hasMore).toBe(false);
    expect(early.latestSeq).toBe(4000);
    expect(io.bytes).toBeLessThan(fileSize / 2);
  });
});

describe("maxSeqFromTranscriptTail", () => {
  const usage = {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 15,
  };

  async function loadTail() {
    return import("./conversation-transcript-seq.js");
  }

  function expectTailEqualsScan(tail: number, scan: number): void {
    expect(tail).toBe(scan);
    expect(scan).toBeGreaterThan(0);
  }

  it("matches a full scan for a normal, a forked, and a legacy transcript", async () => {
    const count = 4000;
    writeTranscript(
      "normal",
      linesOf(Array.from({ length: count }, (_, i) => i + 1), () => "n".repeat(40)),
    );
    const normalSize = statSync(transcriptPath("normal")).size;

    const { copyInheritedHistory } = await import("./conversation-fork.js");
    writeTranscript(
      "fork-source",
      [
        JSON.stringify({ type: "prompt", text: "go", at: AT, seq: 1 }),
        JSON.stringify({ type: "assistant", text: "legacy", at: AT }),
        JSON.stringify({ type: "usage", usage, at: AT, seq: 3 }),
        JSON.stringify({ type: "prompt", text: "later", at: AT, seq: 4 }),
      ].join("\n") + "\n",
    );
    copyInheritedHistory({
      sourceId: "fork-source",
      targetId: "forked",
      forkedAtSeq: 3,
    });

    writeTranscript(
      "legacy",
      [
        JSON.stringify({ type: "prompt", text: "one", at: AT }),
        JSON.stringify({ type: "assistant", text: "two", at: AT }),
        "not-json",
        JSON.stringify({ type: "assistant", text: "three", at: AT }),
      ].join("\n") + "\n",
    );

    const { maxSeqFromTranscriptTail, maxSeqFromTranscriptFile } = await loadTail();

    io.bytes = 0;
    io.fullBytes = 0;
    io.armed = true;
    const normalTail = maxSeqFromTranscriptTail("normal");
    const normalRead = io.bytes;
    const normalFullRead = io.fullBytes;
    io.armed = false;
    expectTailEqualsScan(normalTail, maxSeqFromTranscriptFile("normal"));
    expect(normalTail).toBe(count);
    expect(normalRead).toBeGreaterThan(0);
    expect(normalRead).toBeLessThan(normalSize / 10);
    expect(normalFullRead).toBe(0);

    const forkedTail = maxSeqFromTranscriptTail("forked");
    expectTailEqualsScan(forkedTail, maxSeqFromTranscriptFile("forked"));
    expect(forkedTail).toBe(3);

    const legacyTail = maxSeqFromTranscriptTail("legacy");
    expectTailEqualsScan(legacyTail, maxSeqFromTranscriptFile("legacy"));
    expect(legacyTail).toBe(4);
  });

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

  it("full-scans when the last event has no stored seq and an earlier seq is higher", async () => {
    writeTranscript(
      "mixed",
      [
        stamped(100, "early"),
        JSON.stringify({ type: "assistant", text: "legacy", at: AT }),
      ].join("\n") + "\n",
    );
    const { maxSeqFromTranscriptTail, maxSeqFromTranscriptFile } = await loadTail();
    const mixed = maxSeqFromTranscriptTail("mixed");
    expect(mixed).toBe(maxSeqFromTranscriptFile("mixed"));
    expect(mixed).toBe(100);
  });
});

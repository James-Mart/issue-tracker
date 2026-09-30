import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { readTranscriptPage as ReadTranscriptPage } from "./transcript-page.js";

const io = vi.hoisted(() => ({ bytes: 0, armed: false }));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const readSync: typeof actual.readSync = (...args) => {
    if (io.armed && typeof args[3] === "number") io.bytes += args[3];
    return actual.readSync(...args);
  };
  return { ...actual, readSync };
});

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
    expect(newest.events.map((event) => event.text)).toEqual(["two", "four"]);

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
    expect(newest.events.map((event) => event.text)).toEqual(["c", "d"]);

    const older = readTranscriptPage("c", { before: 3, limit: 10 });
    expect(older.hasMore).toBe(false);
    expect(older.latestSeq).toBe(5);
    expect(older.events.map((event) => ({ seq: event.seq, text: event.text }))).toEqual([
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
    expect(plain.events.map((event) => event.text)).toEqual(["héllo 你好", "tail"]);
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

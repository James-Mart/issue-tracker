import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJsonlRecord,
  resetJsonlAppendState,
} from "./jsonl-append.js";

let dir: string;
const dirs: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jsonl-append-"));
  dirs.push(dir);
  resetJsonlAppendState();
});

afterEach(() => {
  for (const entry of dirs.splice(0)) {
    rmSync(entry, { recursive: true, force: true });
  }
  resetJsonlAppendState();
});

function lines(filePath: string): string[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim());
}

describe("appendJsonlRecord", () => {
  it("creates the file and its directory, one newline-terminated line per record", async () => {
    const filePath = join(dir, "nested", "deeper", "rows.ndjson");

    await appendJsonlRecord(filePath, { a: 1 });
    await appendJsonlRecord(filePath, { a: 2 });

    expect(readFileSync(filePath, "utf8")).toBe('{"a":1}\n{"a":2}\n');
  });

  it("keeps concurrent appends to one file whole and ordered", async () => {
    const filePath = join(dir, "rows.ndjson");
    const payload = "x".repeat(200_000);

    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        appendJsonlRecord(filePath, { i, payload }),
      ),
    );

    const parsed = lines(filePath).map((line) => JSON.parse(line) as { i: number });
    expect(parsed).toHaveLength(25);
    expect(parsed.map((row) => row.i)).toEqual(
      Array.from({ length: 25 }, (_, i) => i),
    );
  });

  it("drops a partial trailing record left by an interrupted append", async () => {
    const filePath = join(dir, "rows.ndjson");
    // Two committed records plus a torn third, as a crash mid-append leaves it.
    writeFileSync(filePath, '{"a":1}\n{"a":2}\n{"a":3,"unfin');

    await appendJsonlRecord(filePath, { a: 4 });

    expect(readFileSync(filePath, "utf8")).toBe('{"a":1}\n{"a":2}\n{"a":4}\n');
    expect(lines(filePath).map((line) => JSON.parse(line))).toEqual([
      { a: 1 },
      { a: 2 },
      { a: 4 },
    ]);
  });

  it("repairs a torn tail longer than one scan chunk", async () => {
    const filePath = join(dir, "rows.ndjson");
    const big = JSON.stringify({ big: "y".repeat(2_000_000) });
    writeFileSync(filePath, `${big}\n${"z".repeat(1_500_000)}`);

    await appendJsonlRecord(filePath, { a: 1 });

    expect(lines(filePath)).toEqual([big, '{"a":1}']);
  });

  it("truncates a file that is nothing but a partial record", async () => {
    const filePath = join(dir, "rows.ndjson");
    writeFileSync(filePath, '{"a":1,"unfin');

    await appendJsonlRecord(filePath, { a: 2 });

    expect(readFileSync(filePath, "utf8")).toBe('{"a":2}\n');
  });

  it("checks the tail once, then leaves its own complete appends alone", async () => {
    const filePath = join(dir, "rows.ndjson");
    await appendJsonlRecord(filePath, { a: 1 });

    // A torn tail arriving after the first append is not re-checked; the
    // guarantee is about crashes between processes, not mid-run corruption.
    writeFileSync(filePath, '{"a":1}\n{"a":2,"unfin', { flag: "w" });
    await appendJsonlRecord(filePath, { a: 3 });
    expect(readFileSync(filePath, "utf8")).toBe(
      '{"a":1}\n{"a":2,"unfin{"a":3}\n',
    );

    // A fresh process would repair it.
    resetJsonlAppendState();
    writeFileSync(filePath, '{"a":1}\n{"a":2,"unfin', { flag: "w" });
    await appendJsonlRecord(filePath, { a: 3 });
    expect(readFileSync(filePath, "utf8")).toBe('{"a":1}\n{"a":3}\n');
  });

  it("keeps later appends working after one fails", async () => {
    const filePath = join(dir, "rows.ndjson");
    await expect(
      appendJsonlRecord(filePath, { bad: 1n as unknown as number }),
    ).rejects.toThrow();

    await appendJsonlRecord(filePath, { a: 1 });
    expect(readFileSync(filePath, "utf8")).toBe('{"a":1}\n');
  });
});

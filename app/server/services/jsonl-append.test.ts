import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendJsonlRecord, resetJsonlAppendState } from "./jsonl-append.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jsonl-append-"));
  resetJsonlAppendState();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  resetJsonlAppendState();
});

function lines(filePath: string): string[] {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim());
}

describe("appendJsonlRecord", () => {
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
  });
});

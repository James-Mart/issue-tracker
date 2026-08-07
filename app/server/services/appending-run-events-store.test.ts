import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JSONL_LOCAL_AGENT_STORE_FILES,
  JsonlLocalAgentStore,
} from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAppendingRunEventsStore,
  evictAppendingRunEventsStore,
  isAppendingRunEventsStore,
} from "./appending-run-events-store.js";

const RUN_A = "run-a";
const RUN_B = "run-b";

let storeDir: string;
const dirs: string[] = [];

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "appending-run-events-"));
  dirs.push(storeDir);
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    evictAppendingRunEventsStore(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function open(dir = storeDir) {
  const jsonl = new JsonlLocalAgentStore(dir);
  return {
    jsonl,
    appending: createAppendingRunEventsStore(dir, jsonl.runEvents),
  };
}

function newDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "appending-run-events-"));
  dirs.push(dir);
  return dir;
}

function eventsFile(dir: string): string {
  return join(dir, JSONL_LOCAL_AGENT_STORE_FILES.runEvents);
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("createAppendingRunEventsStore", () => {
  it("numbers seq per run and returns the SDK's document shape", async () => {
    const { appending } = open();

    const first = await appending.append({
      runId: RUN_A,
      eventType: "run_stream_event",
      payload: { hello: "world" },
    });
    const second = await appending.append({ runId: RUN_A, eventType: "e" });
    const other = await appending.append({ runId: RUN_B, eventType: "e" });

    expect(first).toEqual({
      runId: RUN_A,
      seq: 1,
      offset: "1",
      eventType: "run_stream_event",
      payload: { hello: "world" },
      payloadRef: null,
      idempotencyKey: null,
      createdAt: expect.any(Number),
    });
    expect(second.seq).toBe(2);
    expect(second.offset).toBe("2");
    // Sequences are per run, not per file.
    expect(other.seq).toBe(1);
    expect(first.createdAt).toBeGreaterThan(0);
  });

  it("writes the same bytes the SDK's rewrite would have", async () => {
    const appendDir = newDir();
    const rewriteDir = newDir();
    const { appending } = open(appendDir);
    const raw = new JsonlLocalAgentStore(rewriteDir);

    const inputs = [
      { runId: RUN_A, eventType: "a", payload: { n: 1 } },
      { runId: RUN_B, eventType: "b", payload: null },
      { runId: RUN_A, eventType: "c", payload: { nested: { deep: true } } },
      { runId: RUN_A, eventType: "d" },
    ];
    for (const input of inputs) {
      await appending.append(input);
      await raw.runEvents.append(input);
    }

    // `createdAt` is a timestamp, so compare every field but that one.
    const strip = (text: string) =>
      text
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const row = JSON.parse(line) as Record<string, unknown>;
          delete row.createdAt;
          return row;
        });

    expect(strip(readFileSync(eventsFile(appendDir), "utf8"))).toEqual(
      strip(readFileSync(eventsFile(rewriteDir), "utf8")),
    );
  });

  it("appends rows the SDK's own reader lists back in order", async () => {
    const { jsonl, appending } = open();

    for (let i = 0; i < 5; i++) {
      await appending.append({ runId: RUN_A, eventType: "e", payload: { i } });
    }
    await appending.append({ runId: RUN_B, eventType: "other" });

    const listed = await jsonl.runEvents.list({ runId: RUN_A });
    expect(listed.items.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(listed.items.map((item) => item.payload)).toEqual([
      { i: 0 },
      { i: 1 },
      { i: 2 },
      { i: 3 },
      { i: 4 },
    ]);

    // The wrapper's own list matches, and resumes from an offset.
    expect(await appending.list({ runId: RUN_A })).toEqual(listed);
    const tail = await appending.list({ runId: RUN_A, afterOffset: "3" });
    expect(tail.items.map((item) => item.seq)).toEqual([4, 5]);
  });

  it("continues the sequence a previous process left on disk", async () => {
    const { jsonl } = open();
    await jsonl.runEvents.append({ runId: RUN_A, eventType: "old" });
    await jsonl.runEvents.append({ runId: RUN_A, eventType: "old" });

    // A wrapper opened after those writes must not restart at 1.
    const { appending } = open();
    expect(await appending.append({ runId: RUN_A, eventType: "new" })).toMatchObject(
      { seq: 3 },
    );
  });

  it("keeps concurrent appends on distinct sequences", async () => {
    const { appending } = open();

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        appending.append({ runId: RUN_A, eventType: "e", payload: { i } }),
      ),
    );

    expect([...results.map((r) => r.seq)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it("delegates an idempotent append and re-reads the sequence afterwards", async () => {
    const { appending } = open();
    await appending.append({ runId: RUN_A, eventType: "e" });

    const keyed = await appending.append({
      runId: RUN_A,
      eventType: "e",
      idempotencyKey: "k1",
    });
    expect(keyed.seq).toBe(2);
    expect(keyed.idempotencyKey).toBe("k1");

    // Same key returns the existing row rather than a third.
    const repeat = await appending.append({
      runId: RUN_A,
      eventType: "e",
      idempotencyKey: "k1",
    });
    expect(repeat).toEqual(keyed);

    // The index rebuilt around the delegated write, so the next seq is 3.
    expect(await appending.append({ runId: RUN_A, eventType: "e" })).toMatchObject(
      { seq: 3 },
    );
  });

  it("delete delegates and resets the sequence index", async () => {
    const { appending } = open();
    await appending.append({ runId: RUN_A, eventType: "e" });
    await appending.append({ runId: RUN_B, eventType: "e" });

    await appending.delete({ filter: { runIds: [RUN_A] } });

    expect(await appending.list({ runId: RUN_A })).toMatchObject({ items: [] });
    expect((await appending.list({ runId: RUN_B })).items).toHaveLength(1);
    // RUN_A's rows are gone, so its next event starts over.
    expect(await appending.append({ runId: RUN_A, eventType: "e" })).toMatchObject(
      { seq: 1 },
    );
    expect(await appending.append({ runId: RUN_B, eventType: "e" })).toMatchObject(
      { seq: 2 },
    );
  });

  it("append writes in place where the SDK's append replaces the file", async () => {
    const appendDir = newDir();
    const { appending } = open(appendDir);

    await appending.append({ runId: RUN_A, eventType: "e" });
    const appendInode = statSync(eventsFile(appendDir)).ino;
    await appending.append({ runId: RUN_A, eventType: "e" });
    expect(statSync(eventsFile(appendDir)).ino).toBe(appendInode);

    // The SDK writes through a temp file and renames, so its inode changes.
    const rewriteDir = newDir();
    const raw = new JsonlLocalAgentStore(rewriteDir);
    await raw.runEvents.append({ runId: RUN_A, eventType: "e" });
    const rewriteInode = statSync(eventsFile(rewriteDir)).ino;
    await raw.runEvents.append({ runId: RUN_A, eventType: "e" });
    expect(statSync(eventsFile(rewriteDir)).ino).not.toBe(rewriteInode);
  });

  // The point of appending: cost per event must not track file size. Compared
  // against this wrapper on a small file rather than against the SDK, so the
  // bound does not depend on how expensive fsync happens to be on the host.
  it(
    "append cost does not grow with the file",
    async () => {
      const dir = newDir();
      const { appending } = open(dir);
      const payload = { blob: "p".repeat(64 * 1024) };

      const timeAppends = async (count: number): Promise<number> => {
        const times: number[] = [];
        for (let i = 0; i < count; i++) {
          const t0 = performance.now();
          await appending.append({ runId: RUN_A, eventType: "e", payload });
          times.push(performance.now() - t0);
        }
        return median(times);
      };

      const small = await timeAppends(20);
      await timeAppends(50);
      // Large enough that a rewrite of it would dominate any fsync.
      expect(statSync(eventsFile(dir)).size).toBeGreaterThan(4_000_000);
      const large = await timeAppends(20);

      expect(large).toBeLessThan(small * 4);
    },
    30_000,
  );

  it("marks wrappers from createAppendingRunEventsStore", () => {
    const { jsonl, appending } = open();
    expect(isAppendingRunEventsStore(appending)).toBe(true);
    expect(isAppendingRunEventsStore(jsonl.runEvents)).toBe(false);
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

describe("createAppendingRunEventsStore", () => {
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
});

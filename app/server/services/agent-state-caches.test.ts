import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlLocalAgentStore } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evictConversationStoreCaches } from "./agent-state-caches.js";
import { createAppendingRunEventsStore } from "./appending-run-events-store.js";
import { createCachedCheckpointsStore } from "./cached-checkpoints-store.js";

const AGENT_A = "agent-a";
const RUN_A = "run-a";

let storeDir: string;
const dirs: string[] = [];

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "agent-state-caches-"));
  dirs.push(storeDir);
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    evictConversationStoreCaches(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function open(dir: string) {
  const jsonl = new JsonlLocalAgentStore(dir);
  return {
    jsonl,
    checkpoints: createCachedCheckpointsStore(dir, jsonl.checkpoints),
    runEvents: createAppendingRunEventsStore(dir, jsonl.runEvents),
  };
}

describe("evictConversationStoreCaches", () => {
  it("evicts checkpoint and run-event indexes for storeDir and each nested child", async () => {
    const nestedA = join(storeDir, "nested", "agent-a");
    const nestedB = join(storeDir, "nested", "agent-b");
    mkdirSync(nestedA, { recursive: true });
    mkdirSync(nestedB, { recursive: true });
    writeFileSync(join(storeDir, "nested", "not-a-dir"), "x");

    const root = open(storeDir);
    const childA = open(nestedA);
    const childB = open(nestedB);

    await root.checkpoints.create({
      agentId: AGENT_A,
      blobId: "r",
      data: new Uint8Array([1]),
    });
    await childA.checkpoints.create({
      agentId: AGENT_A,
      blobId: "a",
      data: new Uint8Array([2]),
    });
    await root.runEvents.append({ runId: RUN_A, eventType: "e" });
    expect(await childB.checkpoints.list()).toMatchObject({ items: [] });

    // Stale both indexes by writing through the underlying Jsonl substores.
    await root.jsonl.checkpoints.create({
      agentId: AGENT_A,
      blobId: "sneak-root",
      data: new Uint8Array([9]),
    });
    await childA.jsonl.checkpoints.create({
      agentId: AGENT_A,
      blobId: "sneak-a",
      data: new Uint8Array([8]),
    });
    await root.jsonl.runEvents.append({ runId: RUN_A, eventType: "sneak" });

    expect(
      await root.checkpoints.get({ agentId: AGENT_A, blobId: "sneak-root" }),
    ).toBeNull();
    expect(
      await childA.checkpoints.get({ agentId: AGENT_A, blobId: "sneak-a" }),
    ).toBeNull();

    evictConversationStoreCaches(storeDir);

    expect(
      await root.checkpoints.get({ agentId: AGENT_A, blobId: "sneak-root" }),
    ).toEqual(new Uint8Array([9]));
    expect(
      await childA.checkpoints.get({ agentId: AGENT_A, blobId: "sneak-a" }),
    ).toEqual(new Uint8Array([8]));
    // Rebuilt seq index picks up after the sneaked event rather than colliding.
    expect(await root.runEvents.append({ runId: RUN_A, eventType: "e" })).toMatchObject(
      { seq: 3 },
    );
  });

  it("is safe when nested/ is absent and when nothing was ever cached", () => {
    const lonely = mkdtempSync(join(tmpdir(), "agent-state-caches-lonely-"));
    dirs.push(lonely);
    evictConversationStoreCaches(lonely);
    evictConversationStoreCaches(join(lonely, "never-used"));
  });
});

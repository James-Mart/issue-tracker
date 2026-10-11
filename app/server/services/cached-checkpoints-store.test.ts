import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JSONL_LOCAL_AGENT_STORE_FILES,
  JsonlLocalAgentStore,
} from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCachedCheckpointsStore,
  evictCachedCheckpointsStore,
} from "./cached-checkpoints-store.js";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";

let storeDir: string;
const dirs: string[] = [];

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "cached-ckpt-"));
  dirs.push(storeDir);
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    evictCachedCheckpointsStore(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function openCached(dir = storeDir) {
  const jsonl = new JsonlLocalAgentStore(dir);
  return {
    jsonl,
    cached: createCachedCheckpointsStore(dir, jsonl.checkpoints),
  };
}

function newDir(prefix = "cached-ckpt-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function checkpointsFile(dir: string): string {
  return join(dir, JSONL_LOCAL_AGENT_STORE_FILES.checkpoints);
}

describe("createCachedCheckpointsStore", () => {
  it("create writes the same bytes the SDK's rewrite would have", async () => {
    const appendDir = newDir();
    const rewriteDir = newDir();
    const { cached } = openCached(appendDir);
    const raw = new JsonlLocalAgentStore(rewriteDir);

    for (let i = 0; i < 5; i++) {
      const input = {
        agentId: i % 2 === 0 ? AGENT_A : AGENT_B,
        blobId: `blob-${i}`,
        data: new Uint8Array([i, i + 1, i + 2]),
      };
      await cached.create(input);
      await raw.checkpoints.create(input);
    }

    expect(readFileSync(checkpointsFile(appendDir), "utf8")).toBe(
      readFileSync(checkpointsFile(rewriteDir), "utf8"),
    );
    // And the SDK's own reader agrees about what is in the appended file.
    const reader = new JsonlLocalAgentStore(appendDir);
    expect(await reader.checkpoints.list({ filter: { limit: 100 } })).toEqual(
      await raw.checkpoints.list({ filter: { limit: 100 } }),
    );
    expect(
      await reader.checkpoints.get({ agentId: AGENT_B, blobId: "blob-1" }),
    ).toEqual(Buffer.from([1, 2, 3]));
  });
});

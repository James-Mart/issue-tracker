import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  JSONL_LOCAL_AGENT_STORE_FILES,
  JsonlLocalAgentStore,
} from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createCachedCheckpointsStore,
  evictCachedCheckpointsStore,
  isCachedCheckpointsStore,
} from "./cached-checkpoints-store.js";

const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const BLOB_COUNT = 400;
const PAYLOAD = new Uint8Array(2_048).fill(7);

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

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function seedBlobs(
  checkpoints: ReturnType<typeof openCached>["cached"],
  count: number,
  agentId = AGENT_A,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const blobId = `blob-${String(i).padStart(6, "0")}`;
    ids.push(blobId);
    await checkpoints.create({ agentId, blobId, data: PAYLOAD });
  }
  return ids;
}

describe("createCachedCheckpointsStore", () => {
  // Seed+compare against hundreds of blobs exceeds Vitest's 5s default.
  it(
    "serves get and list from a one-pass index after the first access",
    async () => {
      const { jsonl, cached } = openCached();
      const ids = await seedBlobs(cached, BLOB_COUNT);

      // Warm the index.
      expect(await cached.get({ agentId: AGENT_A, blobId: ids[0]! })).toEqual(
        PAYLOAD,
      );

      const warmGets: number[] = [];
      for (let i = 0; i < 40; i++) {
        const blobId = ids[(i * 9) % ids.length]!;
        const t0 = performance.now();
        const data = await cached.get({ agentId: AGENT_A, blobId });
        warmGets.push(performance.now() - t0);
        expect(data).toEqual(PAYLOAD);
      }

      const rawGets: number[] = [];
      for (let i = 0; i < 40; i++) {
        const blobId = ids[(i * 9) % ids.length]!;
        const t0 = performance.now();
        await jsonl.checkpoints.get({ agentId: AGENT_A, blobId });
        rawGets.push(performance.now() - t0);
      }

      // Cached lookups must stay far below a full-file rescan; require at least
      // a 5× improvement so the assertion fails if the wrapper still scans.
      expect(median(warmGets) * 5).toBeLessThan(median(rawGets));

      const listed = await cached.list({ filter: { limit: 1_000 } });
      expect(listed.items).toHaveLength(BLOB_COUNT);
      expect(listed.nextCursor).toBeUndefined();

      const page = await cached.list({ filter: { limit: 10 } });
      expect(page.items).toHaveLength(10);
      expect(page.nextCursor).toBe(page.items.at(-1));
    },
    15_000,
  );

  it("get returns a fresh buffer so callers cannot poison the index", async () => {
    const { jsonl, cached } = openCached();
    const original = new Uint8Array([1, 2, 3]);
    await jsonl.checkpoints.create({
      agentId: AGENT_A,
      blobId: "buf",
      data: original,
    });

    const first = await cached.get({ agentId: AGENT_A, blobId: "buf" });
    const second = await cached.get({ agentId: AGENT_A, blobId: "buf" });
    expect(first).toEqual(original);
    expect(second).toEqual(original);
    expect(first).not.toBe(second);

    first![0] = 99;
    expect(await cached.get({ agentId: AGENT_A, blobId: "buf" })).toEqual(
      original,
    );
  });

  it("write-through create / update / delete stay visible to get and list", async () => {
    const { cached } = openCached();
    const data1 = new Uint8Array([1, 2, 3]);
    const data2 = new Uint8Array([4, 5, 6]);

    await cached.create({ agentId: AGENT_A, blobId: "b1", data: data1 });
    await cached.create({ agentId: AGENT_B, blobId: "b1", data: data1 });
    await cached.create({ agentId: AGENT_A, blobId: "b2", data: data1 });

    // Force index build, then mutate.
    expect(await cached.get({ agentId: AGENT_A, blobId: "b1" })).toEqual(data1);

    await cached.update({ agentId: AGENT_A, blobId: "b1", data: data2 });
    expect(await cached.get({ agentId: AGENT_A, blobId: "b1" })).toEqual(data2);
    // Sibling agent blob untouched.
    expect(await cached.get({ agentId: AGENT_B, blobId: "b1" })).toEqual(data1);

    await cached.create({ agentId: AGENT_A, blobId: "b3", data: data1 });
    expect(await cached.get({ agentId: AGENT_A, blobId: "b3" })).toEqual(data1);

    await cached.delete({ filter: { agentIds: [AGENT_B], blobIds: ["b1"] } });
    expect(await cached.get({ agentId: AGENT_B, blobId: "b1" })).toBeNull();

    const listed = await cached.list({ filter: { limit: 100 } });
    expect([...listed.items].sort()).toEqual(["b1", "b2", "b3"]);

    const byAgent = await cached.list({
      filter: { agentIds: [AGENT_A], limit: 100 },
    });
    expect([...byAgent.items].sort()).toEqual(["b1", "b2", "b3"]);
  });

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

  it("create appends in place where the SDK's create replaces the file", async () => {
    const appendDir = newDir();
    const { cached } = openCached(appendDir);
    const data = new Uint8Array([1]);

    await cached.create({ agentId: AGENT_A, blobId: "first", data });
    const appendInode = statSync(checkpointsFile(appendDir)).ino;
    await cached.create({ agentId: AGENT_A, blobId: "second", data });
    expect(statSync(checkpointsFile(appendDir)).ino).toBe(appendInode);

    // The SDK writes through a temp file and renames, so its inode changes.
    const rewriteDir = newDir();
    const raw = new JsonlLocalAgentStore(rewriteDir);
    await raw.checkpoints.create({ agentId: AGENT_A, blobId: "first", data });
    const rewriteInode = statSync(checkpointsFile(rewriteDir)).ino;
    await raw.checkpoints.create({ agentId: AGENT_A, blobId: "second", data });
    expect(statSync(checkpointsFile(rewriteDir)).ino).not.toBe(rewriteInode);
  });

  it("create rejects a duplicate blob the way the SDK does", async () => {
    const { jsonl, cached } = openCached();
    const data = new Uint8Array([1]);
    await cached.create({ agentId: AGENT_A, blobId: "dup", data });

    await expect(
      cached.create({ agentId: AGENT_A, blobId: "dup", data }),
    ).rejects.toThrow(
      `Checkpoint blob dup already exists for agent ${AGENT_A}`,
    );
    // A different agent may hold the same blobId.
    await cached.create({ agentId: AGENT_B, blobId: "dup", data });

    // One row per (agent, blob) — the rejected create appended nothing.
    expect(
      readFileSync(checkpointsFile(storeDir), "utf8")
        .split("\n")
        .filter((line) => line.trim()),
    ).toHaveLength(2);
    await expect(
      jsonl.checkpoints.create({ agentId: AGENT_A, blobId: "dup", data }),
    ).rejects.toThrow(
      `Checkpoint blob dup already exists for agent ${AGENT_A}`,
    );
  });

  // The point of appending: cost per create must not track file size. Timed
  // rather than inferred, but compared against this wrapper on a small file
  // instead of against the SDK, so the bound does not depend on how expensive
  // fsync happens to be on the host.
  it(
    "create cost does not grow with the file",
    async () => {
      const dir = newDir();
      const { cached } = openCached(dir);
      const payload = new Uint8Array(64 * 1024).fill(3);
      let blob = 0;

      const timeCreates = async (count: number): Promise<number> => {
        const times: number[] = [];
        for (let i = 0; i < count; i++) {
          const t0 = performance.now();
          await cached.create({
            agentId: AGENT_A,
            blobId: `blob-${String(blob++).padStart(5, "0")}`,
            data: payload,
          });
          times.push(performance.now() - t0);
        }
        return median(times);
      };

      const small = await timeCreates(20);
      await timeCreates(40);
      // Large enough that a rewrite of it would dominate any fsync.
      expect(statSync(checkpointsFile(dir)).size).toBeGreaterThan(4_000_000);
      const large = await timeCreates(20);

      expect(large).toBeLessThan(small * 4);
    },
    30_000,
  );

  it("shares one index across wrappers for the same resolved storeDir", async () => {
    const { cached: a } = openCached();
    const { cached: b } = openCached(resolve(storeDir));

    await a.create({
      agentId: AGENT_A,
      blobId: "shared",
      data: new Uint8Array([9]),
    });
    // Warm via `a`, read via `b` — same module map entry.
    expect(await a.get({ agentId: AGENT_A, blobId: "shared" })).toEqual(
      new Uint8Array([9]),
    );
    expect(await b.get({ agentId: AGENT_A, blobId: "shared" })).toEqual(
      new Uint8Array([9]),
    );

    await b.update({
      agentId: AGENT_A,
      blobId: "shared",
      data: new Uint8Array([8]),
    });
    expect(await a.get({ agentId: AGENT_A, blobId: "shared" })).toEqual(
      new Uint8Array([8]),
    );
  });

  it("marks wrappers from createCachedCheckpointsStore", () => {
    const { jsonl, cached } = openCached();
    expect(isCachedCheckpointsStore(cached)).toBe(true);
    expect(isCachedCheckpointsStore(jsonl.checkpoints)).toBe(false);
  });

  it("evictCachedCheckpointsStore drops the entry so the next access rebuilds", async () => {
    const { jsonl, cached } = openCached();
    await cached.create({
      agentId: AGENT_A,
      blobId: "keep",
      data: new Uint8Array([1]),
    });
    expect(await cached.get({ agentId: AGENT_A, blobId: "keep" })).toEqual(
      new Uint8Array([1]),
    );

    // Bypass the wrapper so the on-disk file diverges from the live index.
    await jsonl.checkpoints.create({
      agentId: AGENT_A,
      blobId: "sneak",
      data: new Uint8Array([2]),
    });
    // Still served from the stale index.
    expect(await cached.get({ agentId: AGENT_A, blobId: "sneak" })).toBeNull();

    evictCachedCheckpointsStore(storeDir);
    expect(await cached.get({ agentId: AGENT_A, blobId: "sneak" })).toEqual(
      new Uint8Array([2]),
    );

    // Safe when absent.
    evictCachedCheckpointsStore(storeDir);
    evictCachedCheckpointsStore(join(storeDir, "never-used"));
  });

  it("honors list cursor / limit / filter the same way as Jsonl", async () => {
    const { jsonl, cached } = openCached();
    await jsonl.checkpoints.create({
      agentId: AGENT_A,
      blobId: "z",
      data: PAYLOAD,
    });
    await jsonl.checkpoints.create({
      agentId: AGENT_A,
      blobId: "a",
      data: PAYLOAD,
    });
    await jsonl.checkpoints.create({
      agentId: AGENT_B,
      blobId: "a",
      data: PAYLOAD,
    });
    await jsonl.checkpoints.create({
      agentId: AGENT_B,
      blobId: "m",
      data: PAYLOAD,
    });

    // Warm cache from disk.
    await cached.list({ filter: { limit: 1000 } });

    expect(await cached.list()).toEqual(await jsonl.checkpoints.list());
    expect(
      await cached.list({ filter: { agentIds: [AGENT_A], limit: 100 } }),
    ).toEqual(
      await jsonl.checkpoints.list({
        filter: { agentIds: [AGENT_A], limit: 100 },
      }),
    );
    expect(
      await cached.list({ filter: { blobIds: ["a"], limit: 100 } }),
    ).toEqual(
      await jsonl.checkpoints.list({ filter: { blobIds: ["a"], limit: 100 } }),
    );

    const page1 = await cached.list({ filter: { limit: 2 } });
    expect(page1).toEqual(
      await jsonl.checkpoints.list({ filter: { limit: 2 } }),
    );
    expect(
      await cached.list({ filter: { cursor: page1.nextCursor, limit: 2 } }),
    ).toEqual(
      await jsonl.checkpoints.list({
        filter: { cursor: page1.nextCursor, limit: 2 },
      }),
    );
  });
});

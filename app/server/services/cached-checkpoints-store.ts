import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  JSONL_LOCAL_AGENT_STORE_FILES,
  paginateCheckpointBlobIds,
  type LocalAgentCheckpointFilter,
  type LocalAgentStoreCheckpoints,
} from "@cursor/sdk";

/**
 * In-memory index over a Jsonl checkpoints substore, keyed by resolved
 * `storeDir` so every `JsonlLocalAgentStore` instance for the same directory
 * shares one cache (fresh stores are constructed on each create/resume).
 */

type BlobIndex = Map<string, Uint8Array>;

interface CacheRecord {
  index: BlobIndex | null;
  build: Promise<BlobIndex> | null;
}

const caches = new Map<string, CacheRecord>();

function resolveStoreDir(storeDir: string): string {
  return resolve(storeDir);
}

function blobKey(agentId: string, blobId: string): string {
  return `${agentId}\0${blobId}`;
}

function parseBlobKey(key: string): { agentId: string; blobId: string } {
  const sep = key.indexOf("\0");
  return { agentId: key.slice(0, sep), blobId: key.slice(sep + 1) };
}

/** Same predicate as the SDK's unexported `matchesCheckpointFilter`. */
function matchesCheckpointFilter(
  key: { agentId: string; blobId: string },
  filter?: LocalAgentCheckpointFilter,
): boolean {
  const agentIds = filter?.agentIds;
  const blobIds = filter?.blobIds;
  if (!(agentIds?.length || blobIds?.length)) return true;
  if (agentIds?.length && !agentIds.includes(key.agentId)) return false;
  if (blobIds?.length && !blobIds.includes(key.blobId)) return false;
  return true;
}

function getOrCreateRecord(resolved: string): CacheRecord {
  let record = caches.get(resolved);
  if (!record) {
    record = { index: null, build: null };
    caches.set(resolved, record);
  }
  return record;
}

async function readIndexFromDisk(resolved: string): Promise<BlobIndex> {
  const index: BlobIndex = new Map();
  const filePath = resolve(resolved, JSONL_LOCAL_AGENT_STORE_FILES.checkpoints);
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return index;
    throw err;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as {
      agentId: string;
      blobId: string;
      dataBase64: string;
    };
    index.set(
      blobKey(row.agentId, row.blobId),
      Uint8Array.from(Buffer.from(row.dataBase64, "base64")),
    );
  }
  return index;
}

async function ensureIndex(resolved: string): Promise<BlobIndex> {
  const record = getOrCreateRecord(resolved);
  if (record.index) return record.index;
  if (!record.build) {
    const build = readIndexFromDisk(resolved).then(
      (index) => {
        const current = caches.get(resolved);
        if (current === record && current.build === build) {
          current.index = index;
          current.build = null;
        }
        return index;
      },
      (err: unknown) => {
        const current = caches.get(resolved);
        if (current === record && current.build === build) {
          current.build = null;
        }
        throw err;
      },
    );
    record.build = build;
  }
  return record.build;
}

async function withBuiltIndex(
  resolved: string,
  mutate: (index: BlobIndex) => void,
): Promise<void> {
  const record = caches.get(resolved);
  if (!record) return;
  if (record.build) await record.build;
  const current = caches.get(resolved);
  if (current?.index) mutate(current.index);
}

/**
 * Drop the shared in-memory index for `storeDir`. Safe if that directory has
 * never been cached. The next `get` / `list` rebuilds from disk.
 */
export function evictCachedCheckpointsStore(storeDir: string): void {
  caches.delete(resolveStoreDir(storeDir));
}

/**
 * Wrap a Jsonl checkpoints substore with a `storeDir`-keyed in-memory index.
 * Mutators write through to `underlying`, then update the shared index when it
 * is already built (or mid-build).
 */
export function createCachedCheckpointsStore(
  storeDir: string,
  underlying: LocalAgentStoreCheckpoints,
): LocalAgentStoreCheckpoints {
  const resolved = resolveStoreDir(storeDir);

  return {
    async get(input) {
      const index = await ensureIndex(resolved);
      const data = index.get(blobKey(input.agentId, input.blobId));
      // Fresh buffer each call — matches Jsonl; callers must not poison the index.
      return data ? data.slice() : null;
    },

    async list(input) {
      const index = await ensureIndex(resolved);
      const filter = input?.filter;
      const blobIds: string[] = [];
      for (const key of index.keys()) {
        const parsed = parseBlobKey(key);
        if (matchesCheckpointFilter(parsed, filter)) {
          blobIds.push(parsed.blobId);
        }
      }
      return paginateCheckpointBlobIds(blobIds, filter);
    },

    async create(input) {
      await underlying.create(input);
      await withBuiltIndex(resolved, (index) => {
        index.set(
          blobKey(input.agentId, input.blobId),
          Uint8Array.from(input.data),
        );
      });
    },

    async update(input) {
      await underlying.update(input);
      await withBuiltIndex(resolved, (index) => {
        index.set(
          blobKey(input.agentId, input.blobId),
          Uint8Array.from(input.data),
        );
      });
    },

    async delete(input) {
      await underlying.delete(input);
      await withBuiltIndex(resolved, (index) => {
        for (const key of [...index.keys()]) {
          if (matchesCheckpointFilter(parseBlobKey(key), input.filter)) {
            index.delete(key);
          }
        }
      });
    },
  };
}

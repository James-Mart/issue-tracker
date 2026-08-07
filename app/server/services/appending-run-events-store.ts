import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  JSONL_LOCAL_AGENT_STORE_FILES,
  type LocalAgentRunEventDocument,
  type LocalAgentStoreRunEvents,
} from "@cursor/sdk";
import { appendJsonlRecord, withJsonlFile } from "./jsonl-append.js";

/**
 * Appending wrapper over a Jsonl run-events substore.
 *
 * `runEvents.append` is the hottest writer in the store — one real run logged
 * 635 events — and the SDK implements it by reparsing and rewriting the whole
 * `run_events.ndjson`, which measures ~100ms per event once that file reaches
 * 6.5MB. The only state an append actually needs is the highest `seq` for its
 * run, so this keeps that counter per resolved `storeDir` and appends a single
 * line (see {@link appendJsonlRecord}).
 *
 * `list` and `delete` still delegate: both are called per catch-up or cleanup
 * rather than per event, and keeping them on the SDK's implementation means
 * payloads never have to be held in memory.
 */

/** Highest `seq` seen per `runId`, keyed by resolved `storeDir`. */
interface SeqIndex {
  maxSeqByRun: Map<string, number>;
}

interface CacheRecord {
  index: SeqIndex | null;
  build: Promise<SeqIndex> | null;
}

const caches = new Map<string, CacheRecord>();

/** Tracks wrappers returned by {@link createAppendingRunEventsStore}. */
const appendingWrappers = new WeakSet<object>();

/** True when `runEvents` was produced by {@link createAppendingRunEventsStore}. */
export function isAppendingRunEventsStore(
  runEvents: LocalAgentStoreRunEvents,
): boolean {
  return appendingWrappers.has(runEvents);
}

function runEventsPath(resolved: string): string {
  return resolve(resolved, JSONL_LOCAL_AGENT_STORE_FILES.runEvents);
}

async function readIndexFromDisk(resolved: string): Promise<SeqIndex> {
  const maxSeqByRun = new Map<string, number>();
  let text: string;
  try {
    text = await readFile(runEventsPath(resolved), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { maxSeqByRun };
    }
    throw err;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { runId: string; seq: number };
    const seen = maxSeqByRun.get(row.runId) ?? 0;
    if (row.seq > seen) maxSeqByRun.set(row.runId, row.seq);
  }
  return { maxSeqByRun };
}

async function ensureIndex(resolved: string): Promise<SeqIndex> {
  let record = caches.get(resolved);
  if (!record) {
    record = { index: null, build: null };
    caches.set(resolved, record);
  }
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

/**
 * Drop the shared sequence index for `storeDir`. The next append rebuilds it
 * from disk. Safe if that directory has never been cached.
 */
export function evictAppendingRunEventsStore(storeDir: string): void {
  caches.delete(resolve(storeDir));
}

/**
 * Wrap a Jsonl run-events substore so `append` writes one line instead of
 * rewriting the file.
 */
export function createAppendingRunEventsStore(
  storeDir: string,
  underlying: LocalAgentStoreRunEvents,
): LocalAgentStoreRunEvents {
  const resolved = resolve(storeDir);

  const wrapper: LocalAgentStoreRunEvents = {
    async append(input) {
      // An idempotency key means the append may have to return an existing
      // row, payload included. Nothing in this app sets one, so rather than
      // hold payloads in memory the rare case falls back to the SDK's scan.
      if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
        try {
          return await withJsonlFile(runEventsPath(resolved), () =>
            underlying.append(input),
          );
        } finally {
          evictAppendingRunEventsStore(resolved);
        }
      }

      const { maxSeqByRun } = await ensureIndex(resolved);
      const seq = (maxSeqByRun.get(input.runId) ?? 0) + 1;
      // Claimed before the append so concurrent events cannot share a seq.
      maxSeqByRun.set(input.runId, seq);

      const createdAt = new Date().toISOString();
      const row = {
        runId: input.runId,
        seq,
        offset: String(seq),
        eventType: input.eventType,
        payload: input.payload ?? null,
        payloadRef: input.payloadRef ?? null,
        idempotencyKey: null,
        createdAt,
      };

      try {
        await appendJsonlRecord(runEventsPath(resolved), row);
      } catch (err) {
        if (maxSeqByRun.get(input.runId) === seq) {
          maxSeqByRun.set(input.runId, seq - 1);
        }
        throw err;
      }

      // Matches the SDK's own row-to-document mapping: `createdAt` is stored as
      // an ISO string and surfaced as epoch millis.
      return {
        ...row,
        createdAt: Date.parse(createdAt),
      } satisfies LocalAgentRunEventDocument;
    },

    list: (input) => underlying.list(input),

    async delete(input) {
      await withJsonlFile(runEventsPath(resolved), () =>
        underlying.delete(input),
      );
      evictAppendingRunEventsStore(resolved);
    },
  };
  appendingWrappers.add(wrapper);
  return wrapper;
}

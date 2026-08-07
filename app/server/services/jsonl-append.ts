import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Append one record to an NDJSON file the SDK's `JsonlLocalAgentStore` also
 * reads.
 *
 * The SDK's own writers never append: each one parses the entire file, mutates
 * an array, and rewrites every row through a temp file, fsync, and rename. That
 * makes an append cost O(file), which on a real 33MB `checkpoints.ndjson`
 * measures ~300ms per record. Appending a single line instead keeps the file
 * byte-identical to what a rewrite would have produced, because the SDK
 * serializes one JSON object per line and terminates the file with a newline.
 *
 * Losing the rewrite loses its atomicity, so {@link appendJsonlRecord} makes up
 * the difference two ways: appends to one path are serialized, and the first
 * append of the process repairs a tail left partial by an earlier crash. Without
 * that repair a torn record would sit mid-file, and the SDK's reader tolerates a
 * malformed *last* line only — every later read of the whole store would throw.
 */

/** In-flight append chain per path, so two appends never interleave. */
const chains = new Map<string, Promise<unknown>>();

/** Paths whose directory and trailing byte this process has already settled. */
const prepared = new Set<string>();

const NEWLINE = 0x0a;

/** Chunk size for the backward scan that locates the last complete record. */
const TAIL_SCAN_CHUNK = 1 << 20;

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  // Runs `task` whether or not the previous append settled cleanly: one
  // failure must not strand every later append behind a rejected promise.
  const result = previous.then(task, task);
  const settled = result.then(
    () => {},
    () => {},
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return result;
}

/** Offset just past the file's last newline, or 0 when it has none. */
async function endOfLastRecord(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<number> {
  let end = size;
  while (end > 0) {
    const length = Math.min(TAIL_SCAN_CHUNK, end);
    const chunk = Buffer.alloc(length);
    await handle.read(chunk, 0, length, end - length);
    const index = chunk.lastIndexOf(NEWLINE);
    if (index !== -1) return end - length + index + 1;
    end -= length;
  }
  return 0;
}

/**
 * Drop a trailing partial record. A tail without a newline can only be an
 * append this process (or a previous one) never finished, so nothing durable
 * is discarded.
 */
async function repairTornTail(filePath: string): Promise<void> {
  let handle;
  try {
    handle = await open(filePath, "r+");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    if (last[0] === NEWLINE) return;
    await handle.truncate(await endOfLastRecord(handle, size));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Run `task` with exclusive access to `filePath` among this module's callers.
 *
 * Wrap the SDK's own whole-file writers in this: they read the file and then
 * rename a rewritten copy over it, so an append landing in between would be
 * dropped by the rename. The SDK guards its writers with a mutex of its own,
 * which our appends know nothing about.
 *
 * Must not be nested for one path — `task` calling back into this module for
 * the same file deadlocks.
 */
export function withJsonlFile<T>(
  filePath: string,
  task: () => Promise<T>,
): Promise<T> {
  return enqueue(filePath, task);
}

/**
 * Append `record` as one line, fsynced before resolving. Serialized per path;
 * safe to call concurrently for the same file.
 */
export function appendJsonlRecord(
  filePath: string,
  record: unknown,
): Promise<void> {
  return enqueue(filePath, async () => {
    if (!prepared.has(filePath)) {
      await mkdir(dirname(filePath), { recursive: true });
      await repairTornTail(filePath);
      prepared.add(filePath);
    }

    const handle = await open(filePath, "a");
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
}

/** Test seam: forget which paths were prepared. */
export function resetJsonlAppendState(): void {
  prepared.clear();
}

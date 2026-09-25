// Machine-wide worker-slot pool. Every Vitest run in every checkout of this
// repo draws from it, so concurrent runs share one memory budget. A slot is
// 2 GiB of heap.
//
// State is one lease file per holder in WORKER_SLOT_DIR, recording the
// holder's process group and slot count. Leases are read and written under a
// lock file taken with an exclusive create. A lease whose process group has no
// live process is removed by the next acquisition.

import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export const WORKER_SLOT_DIR = "/tmp/issue-tracker-vitest-slots";

const GIB = 1024 ** 3;
const SLOT_BYTES = 2 * GIB;
const MIN_RESERVE_BYTES = 4 * GIB;
const LOCK_RETRY_MS = 10;
const WAIT_POLL_MS = 250;

type Lease = { path: string; pgid: number; slots: number };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gib(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ESRCH";
}

/**
 * Slots the machine can back: one fewer than the CPUs, and no more than fit in
 * total RAM minus a reserve of max(4 GiB, 25% of RAM) at 2 GiB each.
 */
export function computeWorkerSlotBudget(): number {
  const parallelism = os.availableParallelism();
  const totalmem = os.totalmem();
  const reserve = Math.max(MIN_RESERVE_BYTES, 0.25 * totalmem);
  const memorySlots = Math.floor((totalmem - reserve) / SLOT_BYTES);
  const budget = Math.min(parallelism - 1, memorySlots);
  if (budget < 1) {
    throw new Error(
      `worker-slot budget is ${budget}, below 1: availableParallelism ${parallelism} − 1 = ` +
        `${parallelism - 1}; (totalmem ${gib(totalmem)} − reserve ${gib(reserve)}) / ` +
        `${gib(SLOT_BYTES)} per slot = ${memorySlots}`,
    );
  }
  return budget;
}

function readStat(pid: number | "self"): { state: string; pgrp: number } | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const state = fields[0];
  const pgrp = Number(fields[2]);
  if (!state || !Number.isInteger(pgrp)) throw new Error(`unparseable /proc/${pid}/stat`);
  return { state, pgrp };
}

function isProcessAlive(pid: number): boolean {
  const stat = readStat(pid);
  return stat !== null && stat.state !== "Z";
}

/** Process groups with at least one process that is not a zombie. */
function liveProcessGroups(): Set<number> {
  const groups = new Set<number>();
  for (const entry of readdirSync("/proc")) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const stat = readStat(Number(entry));
    if (stat && stat.state !== "Z") groups.add(stat.pgrp);
  }
  return groups;
}

function ownProcessGroup(): number {
  const stat = readStat("self");
  if (!stat) throw new Error("cannot read /proc/self/stat");
  return stat.pgrp;
}

/** Removes the lock when the pid recorded in it is no longer alive. */
function breakStaleLock(lockPath: string): void {
  let holder: string;
  try {
    holder = readFileSync(lockPath, "utf8");
  } catch (err) {
    if (isMissing(err)) return;
    throw err;
  }
  const pid = Number(holder);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`malformed worker-slot lock ${lockPath}: ${JSON.stringify(holder)}`);
  }
  if (isProcessAlive(pid)) return;
  // Another waiter may already have broken this lock and taken a new one.
  try {
    if (readFileSync(lockPath, "utf8") !== holder) return;
  } catch (err) {
    if (isMissing(err)) return;
    throw err;
  }
  rmSync(lockPath, { force: true });
}

/** The lock is linked into place so it never exists without its holder pid. */
async function withLock<T>(dir: string, fn: () => T): Promise<T> {
  const lockPath = join(dir, "lock");
  const candidate = join(dir, `lock-${process.pid}-${randomUUID()}.tmp`);
  writeFileSync(candidate, String(process.pid));
  try {
    for (;;) {
      try {
        linkSync(candidate, lockPath);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      breakStaleLock(lockPath);
      await delay(LOCK_RETRY_MS);
    }
  } finally {
    rmSync(candidate, { force: true });
  }
  try {
    return fn();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

function readLeases(dir: string): Lease[] {
  const leases: Lease[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith("lease-") || !name.endsWith(".json")) continue;
    const path = join(dir, name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      // Its holder released it on exit without taking the lock.
      if (isMissing(err)) continue;
      throw err;
    }
    const { pgid, slots } = JSON.parse(text) as { pgid?: unknown; slots?: unknown };
    if (!Number.isInteger(pgid) || !Number.isInteger(slots) || (slots as number) < 1) {
      throw new Error(`malformed worker-slot lease ${path}: ${text}`);
    }
    leases.push({ path, pgid: pgid as number, slots: slots as number });
  }
  return leases;
}

/** A multi-slot request never takes the last free slot; a one-slot request may. */
function elasticGrant(requested: number, free: number): number {
  return requested === 1 ? Math.min(1, free) : Math.min(requested, free - 1);
}

/**
 * Resolves with the slots granted to this process's process group, waiting
 * while nothing grantable is free. A multi-slot request is granted
 * `min(requested, free − 1)`; a one-slot request is granted the last free slot.
 *
 * The lease is released when this process exits. A holder that dies without
 * exiting (SIGKILL, crash) keeps its lease while any process in its group is
 * alive, so orphaned workers keep their slots until they exit.
 */
export async function acquireWorkerSlots(
  requested: number,
  dir: string = WORKER_SLOT_DIR,
): Promise<number> {
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`worker-slot request must be a positive integer, got ${requested}`);
  }
  const budget = computeWorkerSlotBudget();
  const pgid = ownProcessGroup();
  mkdirSync(dir, { recursive: true });
  let announced = false;
  for (;;) {
    const attempt = await withLock(dir, () => {
      const live = liveProcessGroups();
      let held = 0;
      for (const lease of readLeases(dir)) {
        if (live.has(lease.pgid)) held += lease.slots;
        else rmSync(lease.path, { force: true });
      }
      const slots = elasticGrant(requested, budget - held);
      if (slots < 1) return { granted: false as const, held };
      const path = join(dir, `lease-${process.pid}-${randomUUID()}.json`);
      writeFileSync(`${path}.tmp`, JSON.stringify({ pid: process.pid, pgid, slots }));
      renameSync(`${path}.tmp`, path);
      return { granted: true as const, path, slots };
    });
    if (attempt.granted) {
      process.on("exit", () => rmSync(attempt.path, { force: true }));
      return attempt.slots;
    }
    if (!announced) {
      announced = true;
      console.error(
        `worker-slot pool: waiting for ${requested} slot(s); ${attempt.held} of ${budget} held`,
      );
    }
    await delay(WAIT_POLL_MS);
  }
}

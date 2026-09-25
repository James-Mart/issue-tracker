import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireWorkerSlots, computeWorkerSlotBudget } from "./worker-slot-pool.js";

const GIB = 1024 ** 3;
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOLDER = join(APP_DIR, "scripts", "worker-slot-pool.test-holder.ts");

// Budget 3: availableParallelism − 1 binds; memory would allow 24 slots.
const PARALLELISM = 4;
const TOTALMEM = 64 * GIB;
const HOLDER_TIMEOUT_MS = 20_000;

function stubMachine(parallelism: number, totalmem: number): void {
  vi.spyOn(os, "availableParallelism").mockReturnValue(parallelism);
  vi.spyOn(os, "totalmem").mockReturnValue(totalmem);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPendingAfter(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const pending = Symbol("pending");
  return (await Promise.race([promise, delay(ms).then(() => pending)])) === pending;
}

function leaseFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith("lease-") && name.endsWith(".json"));
}

function ownProcessGroup(): number {
  const stat = readFileSync("/proc/self/stat", "utf8");
  return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
}

let dir: string;
const groups: number[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "worker-slot-pool-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const pgid of groups.splice(0)) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs the holder fixture. `detached` gives it its own process group, with
 * the holder as leader; otherwise it shares this test worker's group.
 */
function startHolder(
  requested: number,
  mode: "hold" | "orphan" | "exit",
  detached: boolean,
): { child: ChildProcess; granted: Promise<number>; exited: Promise<void> } {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", HOLDER, dir, String(requested), mode, String(PARALLELISM), String(TOTALMEM)],
    { cwd: APP_DIR, detached, stdio: ["ignore", "pipe", "inherit"] },
  );
  if (detached) groups.push(child.pid!);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const granted = new Promise<number>((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = /granted (\d+)/.exec(out);
      if (match) resolve(Number(match[1]));
    });
    void exited.then(() => reject(new Error(`holder exited before a grant: ${out}`)));
  });
  return { child, granted, exited };
}

describe("computeWorkerSlotBudget", () => {
  it("is one fewer than the CPUs when memory allows more", () => {
    stubMachine(4, 64 * GIB);
    expect(computeWorkerSlotBudget()).toBe(3);
  });

  it("reserves 25% of RAM when that exceeds 4 GiB", () => {
    stubMachine(16, 32 * GIB);
    expect(computeWorkerSlotBudget()).toBe(12);
  });

  it("reserves 4 GiB when 25% of RAM is less", () => {
    stubMachine(16, 12 * GIB);
    expect(computeWorkerSlotBudget()).toBe(4);
  });

  it("throws naming the computed values when memory leaves no slot", () => {
    stubMachine(16, 5 * GIB);
    expect(() => computeWorkerSlotBudget()).toThrow(
      "worker-slot budget is 0, below 1: availableParallelism 16 − 1 = 15; " +
        "(totalmem 5.0 GiB − reserve 4.0 GiB) / 2.0 GiB per slot = 0",
    );
  });

  it("throws when a single CPU leaves no slot", () => {
    stubMachine(1, 64 * GIB);
    expect(() => computeWorkerSlotBudget()).toThrow(/budget is 0, below 1: availableParallelism 1/);
  });
});

describe("acquireWorkerSlots", () => {
  beforeEach(() => {
    stubMachine(PARALLELISM, TOTALMEM);
  });

  it("leaves the last free slot on a multi-slot request and a one-slot request takes it", async () => {
    expect(await acquireWorkerSlots(5, dir)).toBe(2);
    expect(await acquireWorkerSlots(1, dir)).toBe(1);

    const leases = leaseFiles(dir).map(
      (name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as { pgid: number; slots: number },
    );
    expect(leases.map((lease) => lease.slots).sort()).toEqual([1, 2]);
    expect(leases.every((lease) => lease.pgid === ownProcessGroup())).toBe(true);
  });

  it(
    "waits while nothing grantable is free and resolves when the holder's group dies",
    async () => {
      const holder = startHolder(5, "hold", true);
      expect(await holder.granted).toBe(2);

      const waiting = acquireWorkerSlots(2, dir);
      expect(await isPendingAfter(waiting, 1_000)).toBe(true);

      process.kill(-holder.child.pid!, "SIGKILL");
      expect(await waiting).toBe(2);
    },
    HOLDER_TIMEOUT_MS,
  );

  it(
    "counts a lease held by a live group whose leader exited",
    async () => {
      const holder = startHolder(5, "orphan", true);
      expect(await holder.granted).toBe(2);
      await holder.exited;

      const waiting = acquireWorkerSlots(2, dir);
      expect(await isPendingAfter(waiting, 1_000)).toBe(true);
      expect(leaseFiles(dir)).toHaveLength(1);

      process.kill(-holder.child.pid!, "SIGKILL");
      expect(await waiting).toBe(2);
    },
    HOLDER_TIMEOUT_MS,
  );

  it(
    "releases a holder's lease when it exits normally, even while its group lives",
    async () => {
      const holder = startHolder(5, "exit", false);
      expect(await holder.granted).toBe(2);
      await holder.exited;

      expect(leaseFiles(dir)).toEqual([]);
      expect(await acquireWorkerSlots(2, dir)).toBe(2);
    },
    HOLDER_TIMEOUT_MS,
  );
});

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireWorkerSlots } from "./worker-slot-pool.js";

const GIB = 1024 ** 3;
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOLDER = join(APP_DIR, "scripts", "worker-slot-pool.test-holder.ts");

// Budget 3: availableParallelism − 1 binds; memory would allow 24 slots.
const PARALLELISM = 4;
const TOTALMEM = 64 * GIB;
const HOLDER_TIMEOUT_MS = 20_000;

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

let dir: string;
const groups: number[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "worker-slot-pool-"));
  vi.spyOn(os, "availableParallelism").mockReturnValue(PARALLELISM);
  vi.spyOn(os, "totalmem").mockReturnValue(TOTALMEM);
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

/** Runs the holder fixture as the leader of its own process group. */
function startHolder(
  requested: number,
  mode: "hold" | "orphan",
): { child: ChildProcess; granted: Promise<number>; exited: Promise<void> } {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", HOLDER, dir, String(requested), mode, String(PARALLELISM), String(TOTALMEM)],
    { cwd: APP_DIR, detached: true, stdio: ["ignore", "pipe", "inherit"] },
  );
  groups.push(child.pid!);
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

describe("acquireWorkerSlots", () => {
  it(
    "waits while nothing grantable is free and resolves when the holder's group dies",
    async () => {
      const holder = startHolder(5, "hold");
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
      const holder = startHolder(5, "orphan");
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
});

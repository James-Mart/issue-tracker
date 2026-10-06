import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureChildReaper,
  REAP_COALESCE_MS,
  reapExitedChildren,
} from "./child-reaper.js";

const strays: ChildProcess[] = [];
let root: string;

function isCollected(pid: number): boolean {
  return procInfo(pid) === null;
}

function procInfo(pid: number): { state: string; ppid: number } | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const state = fields[0];
  const ppid = Number(fields[1]);
  if (!state || !Number.isInteger(ppid)) return null;
  return { state, ppid };
}

/** Node-tracked child that exits immediately, so its SIGCHLD is delivered. */
function spawnExited(): Promise<void> {
  const child = spawn("true", [], { stdio: "ignore" });
  strays.push(child);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
}

/**
 * Grandchild that has already exited. The parent exits without waiting, so
 * the zombie is reparented here and is not in Node's tracked set. A `/proc`
 * scan would collect it; while it stays `Z`, no scan has run.
 */
async function spawnExitedOrphan(): Promise<number> {
  const pidFile = join(
    root,
    `orphan-${Date.now()}-${Math.random().toString(16).slice(2)}.pid`,
  );
  const parent = spawn(
    "python3",
    [
      "-c",
      `import os
pid = os.fork()
if pid == 0:
    os._exit(0)
open(${JSON.stringify(pidFile)}, "w").write(str(pid))
os._exit(0)
`,
    ],
    { stdio: "ignore" },
  );
  strays.push(parent);
  await new Promise<void>((resolve, reject) => {
    parent.once("error", reject);
    parent.once("exit", () => resolve());
  });
  return Number(readFileSync(pidFile, "utf8"));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "child-reaper-"));
  ensureChildReaper();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  for (const child of strays) {
    if (
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // Already collected.
      }
    }
  }
  strays.length = 0;
  await vi.advanceTimersByTimeAsync(REAP_COALESCE_MS);
  vi.useRealTimers();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("child reaper", () => {
  it("merges SIGCHLD bursts inside 250ms into one trailing /proc scan", async () => {
    expect(REAP_COALESCE_MS).toBe(250);
    const pid = await spawnExitedOrphan();
    expect(procInfo(pid)).toEqual({ state: "Z", ppid: process.pid });

    for (let i = 0; i < 4; i++) {
      await spawnExited();
      await new Promise((resolve) => setImmediate(resolve));
      expect(procInfo(pid)?.state).toBe("Z");
    }

    await vi.advanceTimersByTimeAsync(REAP_COALESCE_MS - 1);
    expect(procInfo(pid)?.state).toBe("Z");
    await spawnExited();
    await new Promise((resolve) => setImmediate(resolve));
    expect(procInfo(pid)?.state).toBe("Z");

    await vi.advanceTimersByTimeAsync(1);
    expect(isCollected(pid)).toBe(true);

    const again = await spawnExitedOrphan();
    expect(procInfo(again)?.state).toBe("Z");
    await vi.advanceTimersByTimeAsync(REAP_COALESCE_MS - 1);
    expect(procInfo(again)?.state).toBe("Z");
    await vi.advanceTimersByTimeAsync(1);
    expect(isCollected(again)).toBe(true);
  });

  it("reaps an orphaned zombie immediately when asked", async () => {
    const pid = await spawnExitedOrphan();
    await new Promise((resolve) => setImmediate(resolve));
    expect(procInfo(pid)?.state).toBe("Z");
    reapExitedChildren();
    expect(isCollected(pid)).toBe(true);
  });

  it("leaves a detached Node-tracked child for Node to waitpid", async () => {
    const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    strays.push(child);
    child.unref();
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.on("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    const started = Date.now();
    process.kill(child.pid!, "SIGTERM");
    expect(await exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(Date.now() - started).toBeLessThan(200);
    expect(isCollected(child.pid!)).toBe(true);
  });
});

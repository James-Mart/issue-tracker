import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureChildReaper } from "./child-reaper.js";

const strays: ChildProcess[] = [];

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

beforeAll(() => {
  ensureChildReaper();
});

afterEach(() => {
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
});

describe("child reaper", () => {
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

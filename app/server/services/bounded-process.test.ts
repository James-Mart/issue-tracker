import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { killProcessGroup } from "./bounded-process.js";

const strays: ChildProcess[] = [];

afterEach(() => {
  for (const child of strays) {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  strays.length = 0;
});

describe("killProcessGroup", () => {
  it("kills a grandchild that ignores SIGHUP", async () => {
    const root = mkdtempSync(join(tmpdir(), "bounded-process-"));
    const pidFile = join(root, "grandchild.pid");
    const child = spawn(
      "sh",
      ["-c", `bash -c 'trap "" HUP; sleep 30' & echo $! > ${JSON.stringify(pidFile)}; wait`],
      { detached: true, stdio: "ignore" },
    );
    strays.push(child);
    try {
      const grandchild = Number(await waitForFile(pidFile));
      expect(Number.isInteger(grandchild)).toBe(true);
      killProcessGroup(child.pid!);
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
      expect(await waitForCollection(grandchild)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

async function waitForFile(path: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    if (existsSync(path)) {
      const body = readFileSync(path, "utf8").trim();
      if (body) return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${path}`);
}

function isCollected(pid: number): boolean {
  return !existsSync(`/proc/${pid}`);
}

async function waitForCollection(pid: number): Promise<boolean> {
  for (let i = 0; i < 100 && !isCollected(pid); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return isCollected(pid);
}

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runWithDeadline } from "./run-with-deadline.js";

/** True when the pid is still executing. A zombie has already been killed. */
function isRunning(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const state = stat.slice(stat.lastIndexOf(")") + 1).trim().split(" ")[0];
    return state !== "Z";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Collection removes the /proc entry. State Z is still unreaped. */
function isCollected(pid: number): boolean {
  return !existsSync(`/proc/${pid}`);
}

async function waitForPid(pidFile: string): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8"));
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`pid file was not written: ${pidFile}`);
}

describe("runWithDeadline", () => {
  it("resolves 124 and kills grandchildren when the child outlives the deadline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-with-deadline-"));
    const pidFile = join(dir, "grandchild.pid");
    writeFileSync(
      join(dir, "child.mjs"),
      [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        'const grandchild = spawn("sleep", ["5"], { stdio: "ignore" });',
        `writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));`,
        "setTimeout(() => process.exit(0), 4000);",
        "",
      ].join("\n"),
    );

    let grandchildPid: number | undefined;
    try {
      const pending = runWithDeadline({
        command: process.execPath,
        args: [join(dir, "child.mjs")],
        cwd: dir,
        deadlineMs: 1_500,
      });
      grandchildPid = await waitForPid(pidFile);
      const code = await pending;
      expect(code).toBe(124);
      expect(isCollected(grandchildPid)).toBe(true);
    } finally {
      if (grandchildPid !== undefined && isRunning(grandchildPid)) {
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a failing child's exit code", async () => {
    const code = await runWithDeadline({
      command: process.execPath,
      args: ["-e", "process.exit(2)"],
      cwd: tmpdir(),
      deadlineMs: 5_000,
    });
    expect(code).toBe(2);
  });
});

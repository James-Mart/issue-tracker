import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exitAfterDeadlineStop,
  runWithDeadline,
  UNIT_SUITE_DEADLINE_MS,
  unitSuiteCommand,
} from "./run-with-deadline.js";

const LINT_SCRIPTS = [
  "lint:boundary",
  "lint:spawns",
  "lint:cli-forms",
  "lint:skill-paths",
  "lint:pipeline-shape",
  "lint:transport",
  "lint:file-length",
  "typecheck",
];

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

function procInfo(pid: number): { state: string; ppid: number } | null {
  if (!existsSync(`/proc/${pid}/stat`)) return null;
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return { state: fields[0]!, ppid: Number(fields[1]) };
}

async function waitForCollection(pid: number): Promise<boolean> {
  for (let i = 0; i < 150 && !isCollected(pid); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return isCollected(pid);
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
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

  it("resolves 0 when a fast child exits first", async () => {
    const code = await runWithDeadline({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: tmpdir(),
      deadlineMs: 5_000,
    });
    expect(code).toBe(0);
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

  it("collects a grandchild that exits while the run is still pending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-with-deadline-"));
    const leaderFile = join(dir, "leader.pid");
    const grandFile = join(dir, "grandchild.pid");
    const py = [
      "import os, time",
      `with open(${JSON.stringify(leaderFile)}, "w") as fh:`,
      "    fh.write(str(os.getpid()))",
      "mid = os.fork()",
      "if mid == 0:",
      "    g = os.fork()",
      "    if g == 0:",
      `        with open(${JSON.stringify(grandFile)}, "w") as fh:`,
      "            fh.write(str(os.getpid()))",
      "        time.sleep(1.0)",
      "        os._exit(0)",
      "    os._exit(0)",
      "time.sleep(30)",
    ].join("\n");

    let leaderPid: number | undefined;
    const pending = runWithDeadline({
      command: "python3",
      args: ["-c", py],
      cwd: dir,
      deadlineMs: 15_000,
    });
    const settled = pending.then(
      (code) => ({ ok: true as const, code }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    try {
      leaderPid = await waitForPid(leaderFile);
      const grandchildPid = await waitForPid(grandFile);
      const info = procInfo(grandchildPid);
      expect(info?.ppid).toBe(process.pid);
      expect(info?.state).not.toBe("Z");
      expect(await waitForCollection(grandchildPid)).toBe(true);
      expect(isCollected(grandchildPid)).toBe(true);
    } finally {
      if (leaderPid !== undefined) killGroup(leaderPid);
      await settled;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("deadline stop sequence", () => {
  const groups: number[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const pid of groups) killGroup(pid);
    groups.length = 0;
  });

  it("exits 0 only after SIGTERM collects the group", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-with-deadline-"));
    const readyFile = join(dir, "ready");
    const sigFile = join(dir, "signal");
    writeFileSync(
      join(dir, "child.mjs"),
      [
        'import { writeFileSync } from "node:fs";',
        "process.on('SIGTERM', () => {",
        `  writeFileSync(${JSON.stringify(sigFile)}, "TERM");`,
        "  setTimeout(() => process.exit(0), 400);",
        "});",
        `writeFileSync(${JSON.stringify(readyFile)}, String(process.pid));`,
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
    );
    const child = spawn(process.execPath, [join(dir, "child.mjs")], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;
    groups.push(pid);
    const exits: Array<number | undefined> = [];
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      expect(isCollected(pid)).toBe(true);
      exits.push(code);
      return undefined as never;
    }) as typeof process.exit);
    try {
      await waitForPid(readyFile);
      const pending = exitAfterDeadlineStop(pid);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(exits).toEqual([]);
      expect(existsSync(`/proc/${pid}`)).toBe(true);
      await pending;
      expect(exits).toEqual([0]);
      expect(readFileSync(sigFile, "utf8")).toBe("TERM");
      expect(isCollected(pid)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    "writes the stderr failure and exits 1 only after a group still uncollected past KILL_GRACE is collected",
    async () => {
      const child = spawn("sh", ["-c", "trap '' TERM; sleep 300"], {
        detached: true,
        stdio: "ignore",
      });
      const pid = child.pid!;
      groups.push(pid);
      const realKill = process.kill.bind(process);
      let deliver = false;
      let stderr = "";
      const exits: Array<number | undefined> = [];
      vi.spyOn(process, "kill").mockImplementation(((
        target: number,
        signal?: NodeJS.Signals | number,
      ) => {
        if (!deliver && (signal === "SIGTERM" || signal === "SIGKILL")) {
          return true;
        }
        return realKill(target, signal as NodeJS.Signals);
      }) as typeof process.kill);
      vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
        stderr += String(msg);
      });
      vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
        expect(isCollected(pid)).toBe(true);
        expect(stderr).toMatch(/survived SIGKILL/);
        exits.push(code);
        return undefined as never;
      }) as typeof process.exit);
      const pending = exitAfterDeadlineStop(pid);
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      expect(exits).toEqual([]);
      expect(stderr).toBe("");
      expect(existsSync(`/proc/${pid}`)).toBe(true);
      deliver = true;
      realKill(-pid, "SIGKILL");
      await pending;
      expect(exits).toEqual([1]);
      expect(isCollected(pid)).toBe(true);
    },
    20_000,
  );

  it("drops a recorded pid owned by another process without signaling it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-with-deadline-"));
    const pidFile = join(dir, "held.pid");
    const holder = spawn(
      "sh",
      ["-c", `sleep 300 & echo $! > '${pidFile}'; wait`],
      { detached: true, stdio: "ignore" },
    );
    groups.push(holder.pid!);
    const exits: Array<number | undefined> = [];
    const kill = vi.spyOn(process, "kill");
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exits.push(code);
      return undefined as never;
    }) as typeof process.exit);
    try {
      const childPid = await waitForPid(pidFile);
      const before = procInfo(childPid);
      await exitAfterDeadlineStop(childPid);
      expect(exits).toEqual([0]);
      expect(
        kill.mock.calls.some((call) => Math.abs(Number(call[0])) === childPid),
      ).toBe(false);
      const after = procInfo(childPid);
      expect(after?.ppid).toBe(before?.ppid);
      expect(after?.ppid).not.toBe(process.pid);
      expect(after?.state).not.toBe("Z");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("unitSuiteCommand", () => {
  it("runs the lint chain and then vitest under the three-minute deadline", () => {
    expect(UNIT_SUITE_DEADLINE_MS).toBe(180_000);
    const full = unitSuiteCommand([]);
    expect(full.command).toBe("sh");
    const script = full.args[1] ?? "";
    for (const name of LINT_SCRIPTS) {
      expect(script).toContain(`npm run ${name}`);
    }
    expect(script).toContain("vitest");
    expect(script).toContain(" run");
    const lintAt = script.indexOf("npm run lint:boundary");
    const typecheckAt = script.indexOf("npm run typecheck");
    const vitestAt = script.lastIndexOf("run");
    expect(lintAt).toBeGreaterThanOrEqual(0);
    expect(typecheckAt).toBeGreaterThan(
      script.indexOf("npm run lint:file-length"),
    );
    expect(vitestAt).toBeGreaterThan(typecheckAt);
  });

  it("runs vitest on the given paths and skips the lint chain", () => {
    const filtered = unitSuiteCommand([
      "scripts/run-with-deadline.test.ts",
    ]);
    expect(filtered.command).toMatch(/vitest$/);
    expect(filtered.args).toEqual([
      "run",
      "scripts/run-with-deadline.test.ts",
    ]);
    expect(filtered.args.join(" ")).not.toContain("lint:");
    expect(filtered.args.join(" ")).not.toContain("typecheck");
  });
});

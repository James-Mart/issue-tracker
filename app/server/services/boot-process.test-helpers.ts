import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Build shell that backgrounds `sleep` and waits for `gateFile`. With
 * `phaseMarker`, appends a `build` line there. `append` records more than
 * one boot's pid in the same file.
 */
export function holdOpen(
  pidFile: string,
  gateFile: string,
  options?: { append?: boolean; phaseMarker?: string },
): string {
  const redirect = options?.append ? ">>" : ">";
  const mark = options?.phaseMarker
    ? `; echo build >> ${JSON.stringify(options.phaseMarker)}`
    : "";
  return `sleep 30 & echo $! ${redirect} ${JSON.stringify(pidFile)}${mark}; while [ ! -e ${JSON.stringify(gateFile)} ]; do sleep 0.05; done; kill $!`;
}

function readPids(path: string): number[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => pid > 0);
}

/** SIGKILL pids still listed in `path`. A pid the boot already collected is skipped. */
export function killPidsInFile(path: string): void {
  for (const pid of readPids(path)) {
    if (!existsSync(`/proc/${pid}`)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The boot cancel already collected it.
    }
  }
}

/** `/proc/<pid>/stat` start time. Boot records pin a pid with this token. */
export function procStartTime(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
}

/**
 * A detached shell that forks a sleeper of its own, mirroring how `tsx watch`
 * and Vite each hold children inside the group the service signals. The
 * sleeper's pid is written to `childPidFile`. The shell stays that sleeper's
 * parent, so the sleeper is not a child of this process.
 */
export function spawnDetachedGroup(childPidFile: string): ChildProcess {
  return spawn(
    "sh",
    ["-c", `sleep 300 & echo $! > ${JSON.stringify(childPidFile)}; wait`],
    { detached: true, stdio: "ignore" },
  );
}

/** Spawn a detached group and remember it so the test can SIGKILL strays. */
export function trackDetachedGroup(
  strays: ChildProcess[],
  childPidFile: string,
): ChildProcess {
  const leader = spawnDetachedGroup(childPidFile);
  strays.push(leader);
  return leader;
}

/** First pid written to `path`. */
export async function waitForPidFile(path: string): Promise<number> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const pid = Number(readFileSync(path, "utf8").trim());
      if (pid > 0) return pid;
    }
    await delay(20);
  }
  throw new Error(`timed out waiting for ${path}`);
}

/** SIGKILL stray process groups. A group the test already collected is skipped. */
export function killStrayGroups(strays: readonly ChildProcess[]): void {
  for (const child of strays) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The test already collected the group.
    }
  }
}

/** Pids written one per line, once at least `count` of them are present. */
export async function waitForPids(path: string, count: number): Promise<number[]> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const pids = readPids(path);
    if (pids.length >= count) return pids;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${count} pids in ${path}`);
}

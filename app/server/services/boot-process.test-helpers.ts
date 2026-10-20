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

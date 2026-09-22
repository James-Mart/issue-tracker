import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One collector for this process. It subreaps orphaned descendants and
 * waitpids them when they exit. Node `ChildProcess` handles stay in
 * `trackedPids` so their exit status is left for Node.
 */
const REAPER_KEY = "issueTrackerChildReaper";

interface ReaperGlobal {
  installed: boolean;
  trackerInstalled: boolean;
  trackedPids: Set<number>;
}

interface ChildReaperNative {
  setChildSubreaper: () => void;
  waitPid: (pid: number, flags: number) => { pid: number } | null;
  WNOHANG: number;
}

type ProcessHandle = {
  pid?: number;
  spawn: (options: unknown) => number;
};

const require = createRequire(import.meta.url);
const native = require(
  join(dirname(fileURLToPath(import.meta.url)), "../native/child_reaper.node"),
) as ChildReaperNative;

function reaperState(): ReaperGlobal {
  const g = globalThis as typeof globalThis & { [REAPER_KEY]?: ReaperGlobal };
  if (!g[REAPER_KEY]) {
    g[REAPER_KEY] = {
      installed: false,
      trackerInstalled: false,
      trackedPids: new Set(),
    };
  }
  return g[REAPER_KEY];
}

function installNodeChildTracker(): void {
  const state = reaperState();
  if (state.trackerInstalled) return;
  const wrap = (
    process as NodeJS.Process & {
      binding(name: string): { Process: { prototype: ProcessHandle } };
    }
  ).binding("process_wrap");
  const orig = wrap.Process.prototype.spawn;
  wrap.Process.prototype.spawn = function (this: ProcessHandle, options: unknown) {
    const code = orig.call(this, options);
    if (code === 0 && typeof this.pid === "number") {
      reaperState().trackedPids.add(this.pid);
    }
    return code;
  };
  state.trackerInstalled = true;
}

installNodeChildTracker();

function readProcIdentity(
  pid: number,
): { state: string; ppid: number } | null {
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

/** waitpid children Node is not tracking. Zombies Node still owns are left alone. */
export function reapExitedChildren(): void {
  const { trackedPids } = reaperState();
  for (const pid of trackedPids) {
    if (!existsSync(`/proc/${pid}`)) trackedPids.delete(pid);
  }
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!/^[1-9]\d*$/.test(entry)) continue;
    const pid = Number(entry);
    if (trackedPids.has(pid)) continue;
    const info = readProcIdentity(pid);
    if (!info || info.ppid !== process.pid || info.state !== "Z") continue;
    native.waitPid(pid, native.WNOHANG);
  }
}

/**
 * Idempotent. Sets `PR_SET_CHILD_SUBREAPER` and installs one collector for
 * the life of this process.
 */
export function ensureChildReaper(): void {
  const state = reaperState();
  if (state.installed) return;
  native.setChildSubreaper();
  installNodeChildTracker();
  process.on("SIGCHLD", reapExitedChildren);
  state.installed = true;
  reapExitedChildren();
}

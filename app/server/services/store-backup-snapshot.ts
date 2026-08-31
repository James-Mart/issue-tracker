import chokidar, { type FSWatcher } from "chokidar";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  type Stats,
} from "fs";
import { dirname, join, relative } from "path";
import { readAppConfig } from "../app-config.js";
import {
  backupMirrorDir,
  backupStatusPath,
  issuesDir,
} from "../config.js";
import type { AppConfig, BackupConfig } from "../schemas.js";
import {
  ensureBackupIdentity,
  getCurrentBackupProblem,
  pushMirrorIfAllowed,
  type BackupIdentity,
} from "./store-backup-identity.js";
import { writeProjectsManifest } from "./store-backup-projects-manifest.js";
import { writeRestoreRunbook } from "./store-backup-restore-runbook.js";
import { pushWithRetry } from "./store-backup-status.js";
import {
  commitChanges,
  hasStagedChanges,
  initRepository,
  stageAllChanges,
} from "./git-write.js";

export const SNAPSHOT_DEBOUNCE_MS = 60_000;

/** Backup is active only when configured, enabled, and has a remote target. */
export function isBackupMirrorActive(
  config: AppConfig,
): config is AppConfig & { backup: BackupConfig & { remote: string } } {
  const backup = config.backup;
  if (!backup) return false;
  if (!backup.enabled) return false;
  if (backup.remote === null) return false;
  return true;
}

function listRelativeFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.push(relative(root, full));
      }
    }
  };
  walk(root);
  return files;
}

function removeExtraneousMirrorPaths(sourceDir: string, mirrorDir: string): void {
  if (!existsSync(mirrorDir)) return;
  for (const name of readdirSync(mirrorDir)) {
    const mirrorPath = join(mirrorDir, name);
    const sourcePath = join(sourceDir, name);
    if (!existsSync(sourcePath)) {
      rmSync(mirrorPath, { recursive: true, force: true });
      continue;
    }
    const mirrorStat = statSync(mirrorPath);
    const sourceStat = statSync(sourcePath);
    if (mirrorStat.isDirectory() && sourceStat.isDirectory()) {
      removeExtraneousMirrorPaths(sourcePath, mirrorPath);
    }
  }
}

function mirrorFileNeedsCopy(srcStat: Stats, destStat: Stats): boolean {
  if (srcStat.size !== destStat.size) return true;
  return (
    Math.floor(srcStat.mtimeMs / 1000) !==
    Math.floor(destStat.mtimeMs / 1000)
  );
}

/** Bring `mirrorIssuesDir` into agreement with the live store at `sourceDir`. */
export function syncIssuesToMirror(
  sourceDir: string,
  mirrorIssuesDir: string,
): void {
  mkdirSync(mirrorIssuesDir, { recursive: true });

  for (const rel of listRelativeFiles(sourceDir)) {
    const src = join(sourceDir, rel);
    const dest = join(mirrorIssuesDir, rel);
    const srcStat = statSync(src);
    let needsCopy = true;
    if (existsSync(dest)) {
      needsCopy = mirrorFileNeedsCopy(srcStat, statSync(dest));
    }
    if (needsCopy) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { preserveTimestamps: true });
    }
  }

  removeExtraneousMirrorPaths(sourceDir, mirrorIssuesDir);
}

export function isGitRepository(workspace: string): boolean {
  return existsSync(join(workspace, ".git"));
}

export function formatSnapshotCommitMessage(): string {
  return "Snapshot issue store";
}

export type StoreBackupSnapshotDeps = {
  readAppConfig: () => AppConfig;
  issuesDir: string;
  backupMirrorDir: string;
  debounceMs: number;
  setDebounceTimer: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  clearDebounceTimer: (id: ReturnType<typeof setTimeout>) => void;
  createWatcher: (onActivity: () => void) => { close: () => void };
  syncIssuesToMirror: (sourceDir: string, mirrorIssuesDir: string) => void;
  isGitRepository: (workspace: string) => boolean;
  initRepository: (workspace: string) => Promise<void>;
  stageAllChanges: (workspace: string) => Promise<void>;
  hasStagedChanges: (workspace: string) => Promise<boolean>;
  commitChanges: (workspace: string, message: string) => Promise<void>;
  formatCommitMessage: () => string;
  ensureBackupIdentity: (mirrorDir: string) => BackupIdentity;
  writeProjectsManifest: (mirrorDir: string) => Promise<void>;
  writeRestoreRunbook: (mirrorDir: string) => void;
  pushIfAllowed: (
    workspace: string,
    remoteUrl: string,
    localStoreId: string,
  ) => Promise<"pushed" | "refused">;
};

export function createStoreBackupSnapshotDriver(
  deps: StoreBackupSnapshotDeps,
) {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let watcher: { close: () => void } | undefined;
  let snapshotInFlight = false;
  let snapshotQueued = false;

  function scheduleSnapshot(): void {
    if (debounceTimer !== undefined) {
      deps.clearDebounceTimer(debounceTimer);
    }
    debounceTimer = deps.setDebounceTimer(() => {
      debounceTimer = undefined;
      void takeSnapshot().catch((err) => {
        console.error("store backup snapshot failed:", err);
      });
    }, deps.debounceMs);
  }

  async function runSnapshot(): Promise<void> {
    const config = deps.readAppConfig();
    if (!isBackupMirrorActive(config)) return;

    const mirrorIssuesDir = join(deps.backupMirrorDir, "issues");
    deps.syncIssuesToMirror(deps.issuesDir, mirrorIssuesDir);

    if (!deps.isGitRepository(deps.backupMirrorDir)) {
      await deps.initRepository(deps.backupMirrorDir);
    }

    const identity = deps.ensureBackupIdentity(deps.backupMirrorDir);

    await deps.writeProjectsManifest(deps.backupMirrorDir);
    deps.writeRestoreRunbook(deps.backupMirrorDir);

    await deps.stageAllChanges(deps.backupMirrorDir);
    if (await deps.hasStagedChanges(deps.backupMirrorDir)) {
      await deps.commitChanges(
        deps.backupMirrorDir,
        deps.formatCommitMessage(),
      );
    }

    await deps.pushIfAllowed(
      deps.backupMirrorDir,
      config.backup.remote,
      identity.storeId,
    );
  }

  // Retry can hold a snapshot for a long time; collapse overlapping
  // requests into one trailing run so git writes stay serial.
  async function takeSnapshot(): Promise<void> {
    if (snapshotInFlight) {
      snapshotQueued = true;
      return;
    }
    snapshotInFlight = true;
    try {
      do {
        snapshotQueued = false;
        await runSnapshot();
      } while (snapshotQueued);
    } finally {
      snapshotInFlight = false;
    }
  }

  function start(): void {
    if (!isBackupMirrorActive(deps.readAppConfig())) return;
    watcher = deps.createWatcher(scheduleSnapshot);
  }

  function stop(): void {
    if (debounceTimer !== undefined) {
      deps.clearDebounceTimer(debounceTimer);
      debounceTimer = undefined;
    }
    watcher?.close();
    watcher = undefined;
  }

  return { start, stop, scheduleSnapshot, takeSnapshot };
}

function defaultCreateWatcher(onActivity: () => void): FSWatcher {
  const watcher = chokidar.watch(issuesDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  });
  watcher
    .on("add", () => onActivity())
    .on("change", () => onActivity())
    .on("unlink", () => onActivity())
    .on("unlinkDir", () => onActivity())
    .on("error", (err) => console.error("store backup watcher error:", err));
  return watcher;
}

const defaultDeps = (): StoreBackupSnapshotDeps => ({
  readAppConfig,
  issuesDir,
  backupMirrorDir,
  debounceMs: SNAPSHOT_DEBOUNCE_MS,
  setDebounceTimer: setTimeout,
  clearDebounceTimer: clearTimeout,
  createWatcher: defaultCreateWatcher,
  syncIssuesToMirror,
  isGitRepository,
  initRepository,
  stageAllChanges,
  hasStagedChanges,
  commitChanges,
  formatCommitMessage: formatSnapshotCommitMessage,
  ensureBackupIdentity,
  writeProjectsManifest,
  writeRestoreRunbook,
  pushIfAllowed: (workspace, remoteUrl, localStoreId) =>
    pushWithRetry({
      push: () => pushMirrorIfAllowed(workspace, remoteUrl, localStoreId),
      refusalMessage: () => {
        const problem = getCurrentBackupProblem();
        if (problem === null) {
          throw new Error("backup push refused without a recorded problem");
        }
        return problem.message;
      },
      statusPath: backupStatusPath,
    }),
});

let activeDriver: ReturnType<typeof createStoreBackupSnapshotDriver> | null =
  null;

/** Start observing the store for debounced mirror snapshots at server boot. */
export function startStoreBackupSnapshotDriver(): void {
  if (activeDriver) return;
  activeDriver = createStoreBackupSnapshotDriver(defaultDeps());
  activeDriver.start();
}

/** @internal Reset boot singleton between tests. */
export function resetStoreBackupSnapshotDriverForTests(): void {
  activeDriver?.stop();
  activeDriver = null;
}

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStoreBackupSnapshotDriver,
  formatSnapshotCommitMessage,
  resetStoreBackupSnapshotDriverForTests,
  SNAPSHOT_DEBOUNCE_MS,
  syncIssuesToMirror,
  type StoreBackupSnapshotDeps,
} from "./store-backup-snapshot.js";

let storeRoots: string[] = [];

afterEach(() => {
  resetStoreBackupSnapshotDriverForTests();
  vi.useRealTimers();
  for (const root of storeRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  storeRoots = [];
});

function tempStoreLayout(): {
  issuesDir: string;
  backupMirrorDir: string;
  appConfigPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "store-backup-"));
  storeRoots.push(root);
  const issuesDir = join(root, "issues");
  const backupMirrorDir = join(root, "backup-mirror");
  const appConfigPath = join(root, "app-config.json");
  mkdirSync(issuesDir, { recursive: true });
  return { issuesDir, backupMirrorDir, appConfigPath };
}

function activeBackupConfig() {
  return {
    backup: {
      remote: "git@github.com:me/tracker-backup.git",
      enabled: true,
    },
  } as const;
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function createTestDriver(
  layout: ReturnType<typeof tempStoreLayout>,
  overrides: Partial<StoreBackupSnapshotDeps> = {},
) {
  const gitCalls: { op: string; workspace: string }[] = [];
  let onActivity: (() => void) | undefined;

  const deps: StoreBackupSnapshotDeps = {
    readAppConfig: () => activeBackupConfig(),
    issuesDir: layout.issuesDir,
    backupMirrorDir: layout.backupMirrorDir,
    debounceMs: SNAPSHOT_DEBOUNCE_MS,
    setDebounceTimer: setTimeout,
    clearDebounceTimer: clearTimeout,
    createWatcher: (handler) => {
      onActivity = handler;
      return { close: vi.fn() };
    },
    syncIssuesToMirror,
    isGitRepository: (workspace) => existsSync(join(workspace, ".git")),
    initRepository: async (workspace) => {
      gitCalls.push({ op: "init", workspace });
      mkdirSync(join(workspace, ".git"), { recursive: true });
    },
    stageAllChanges: async (workspace) => {
      gitCalls.push({ op: "stage", workspace });
    },
    hasStagedChanges: async () => true,
    commitChanges: async (workspace) => {
      gitCalls.push({ op: "commit", workspace });
    },
    formatCommitMessage: formatSnapshotCommitMessage,
    ensureBackupIdentity: () => ({ storeId: "test-store-id" }),
    writeProjectsManifest: async () => {},
    writeRestoreRunbook: () => {},
    pushIfAllowed: async (workspace) => {
      gitCalls.push({ op: "push", workspace });
      return "pushed";
    },
    ...overrides,
  };

  const driver = createStoreBackupSnapshotDriver(deps);
  return {
    driver,
    gitCalls,
    triggerChange: () => onActivity?.(),
  };
}

describe("createStoreBackupSnapshotDriver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("never invokes git against the store directory", async () => {
    const layout = tempStoreLayout();
    const { driver, gitCalls, triggerChange } = createTestDriver(layout);

    writeFileSync(join(layout.issuesDir, "touch.txt"), "touch");
    driver.start();
    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    await flushAsyncWork();

    expect(gitCalls.map((call) => call.op)).toEqual([
      "init",
      "stage",
      "commit",
      "push",
    ]);
    expect(
      gitCalls.every((call) => call.workspace === layout.backupMirrorDir),
    ).toBe(true);
  });

  it("runs a trailing snapshot when one is requested during an in-flight push", async () => {
    const layout = tempStoreLayout();
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pushes = 0;
    const { driver, gitCalls } = createTestDriver(layout, {
      pushIfAllowed: async () => {
        pushes += 1;
        if (pushes === 1) {
          notifyStarted();
          await held;
        }
        return "pushed";
      },
    });

    const first = driver.takeSnapshot();
    await started;
    const second = driver.takeSnapshot();
    await second;
    expect(pushes).toBe(1);

    release();
    await first;
    expect(pushes).toBe(2);
    expect(gitCalls.filter((call) => call.op === "commit")).toHaveLength(2);
  });
});

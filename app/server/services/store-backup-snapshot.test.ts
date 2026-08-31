import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  BACKUP_IDENTITY_FILENAME,
  ensureBackupIdentity,
} from "./store-backup-identity.js";
import {
  createStoreBackupSnapshotDriver,
  formatSnapshotCommitMessage,
  isBackupMirrorActive,
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
  const gitCalls: { op: string; workspace: string; message?: string }[] = [];
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
    commitChanges: async (workspace, message) => {
      gitCalls.push({ op: "commit", workspace, message });
    },
    formatCommitMessage: formatSnapshotCommitMessage,
    ensureBackupIdentity: () => ({ storeId: "test-store-id" }),
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

describe("isBackupMirrorActive", () => {
  it("returns false when backup is absent", () => {
    expect(isBackupMirrorActive({})).toBe(false);
  });

  it("returns false when backup is disabled", () => {
    expect(
      isBackupMirrorActive({
        backup: { remote: "git@github.com:me/repo.git", enabled: false },
      }),
    ).toBe(false);
  });

  it("returns false when remote is null", () => {
    expect(
      isBackupMirrorActive({ backup: { remote: null, enabled: true } }),
    ).toBe(false);
  });

  it("returns true when backup is configured and enabled", () => {
    expect(isBackupMirrorActive(activeBackupConfig())).toBe(true);
  });
});

describe("syncIssuesToMirror", () => {
  it("copies new files and removes deleted ones", () => {
    const layout = tempStoreLayout();
    const mirrorIssuesDir = join(layout.backupMirrorDir, "issues");
    writeFileSync(join(layout.issuesDir, "keep.txt"), "keep");
    writeFileSync(join(layout.issuesDir, "gone.txt"), "gone");
    mkdirSync(mirrorIssuesDir, { recursive: true });
    writeFileSync(join(mirrorIssuesDir, "gone.txt"), "gone");
    writeFileSync(join(mirrorIssuesDir, "stale.txt"), "stale");

    rmSync(join(layout.issuesDir, "gone.txt"));
    writeFileSync(join(layout.issuesDir, "new.txt"), "new");

    syncIssuesToMirror(layout.issuesDir, mirrorIssuesDir);

    expect(readFileSync(join(mirrorIssuesDir, "keep.txt"), "utf8")).toBe(
      "keep",
    );
    expect(readFileSync(join(mirrorIssuesDir, "new.txt"), "utf8")).toBe("new");
    expect(existsSync(join(mirrorIssuesDir, "gone.txt"))).toBe(false);
    expect(existsSync(join(mirrorIssuesDir, "stale.txt"))).toBe(false);
  });

  it("skips unchanged files on subsequent syncs", () => {
    const layout = tempStoreLayout();
    const mirrorIssuesDir = join(layout.backupMirrorDir, "issues");
    const sourcePath = join(layout.issuesDir, "stable.txt");
    writeFileSync(sourcePath, "content");

    syncIssuesToMirror(layout.issuesDir, mirrorIssuesDir);
    const mirrorPath = join(mirrorIssuesDir, "stable.txt");
    const mtimeAfterFirst = statSync(mirrorPath).mtimeMs;

    syncIssuesToMirror(layout.issuesDir, mirrorIssuesDir);
    expect(statSync(mirrorPath).mtimeMs).toBe(mtimeAfterFirst);
  });

  it("copies when size or modification time differs", () => {
    const layout = tempStoreLayout();
    const mirrorIssuesDir = join(layout.backupMirrorDir, "issues");
    const sourcePath = join(layout.issuesDir, "project", "issue.json");
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, '{"id":"a"}');
    syncIssuesToMirror(layout.issuesDir, mirrorIssuesDir);

    const mirrorPath = join(mirrorIssuesDir, "project", "issue.json");
    const before = statSync(mirrorPath).mtimeMs;
    writeFileSync(sourcePath, '{"id":"b"}');
    utimesSync(sourcePath, new Date(before + 5_000), new Date(before + 5_000));

    syncIssuesToMirror(layout.issuesDir, mirrorIssuesDir);
    expect(readFileSync(mirrorPath, "utf8")).toBe('{"id":"b"}');
  });
});

describe("createStoreBackupSnapshotDriver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("collapses a burst of changes into one commit after the window", async () => {
    const layout = tempStoreLayout();
    const { driver, gitCalls, triggerChange } = createTestDriver(layout);
    driver.start();
    writeFileSync(join(layout.issuesDir, "a.txt"), "a");

    triggerChange();
    triggerChange();
    triggerChange();

    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS - 1);
    expect(gitCalls.filter((call) => call.op === "commit")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await flushAsyncWork();

    expect(gitCalls.filter((call) => call.op === "commit")).toHaveLength(1);
    expect(gitCalls.filter((call) => call.op === "push")).toHaveLength(1);
    expect(gitCalls.every((call) => call.workspace !== layout.issuesDir)).toBe(
      true,
    );
  });

  it("passes the local store identity and configured remote to the push gate", async () => {
    const layout = tempStoreLayout();
    let seen: { remoteUrl?: string; localStoreId?: string } = {};
    const { driver } = createTestDriver(layout, {
      ensureBackupIdentity: () => ({ storeId: "wired-store-id" }),
      pushIfAllowed: async (_workspace, remoteUrl, localStoreId) => {
        seen = { remoteUrl, localStoreId };
        return "pushed";
      },
    });

    await driver.takeSnapshot();

    expect(seen).toEqual({
      remoteUrl: "git@github.com:me/tracker-backup.git",
      localStoreId: "wired-store-id",
    });
  });

  it("keeps the local snapshot when the remote identity check refuses", async () => {
    const layout = tempStoreLayout();
    const { driver, gitCalls } = createTestDriver(layout, {
      pushIfAllowed: async () => "refused",
    });

    await expect(driver.takeSnapshot()).resolves.toBeUndefined();
    expect(gitCalls.filter((call) => call.op === "commit")).toHaveLength(1);
    expect(gitCalls.filter((call) => call.op === "push")).toHaveLength(0);
  });

  it("restarts the window when a change arrives during debounce", async () => {
    const layout = tempStoreLayout();
    const { driver, gitCalls, triggerChange } = createTestDriver(layout);
    driver.start();

    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS - 1_000);
    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS - 1);
    expect(gitCalls.filter((call) => call.op === "commit")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await flushAsyncWork();
    expect(gitCalls.filter((call) => call.op === "commit")).toHaveLength(1);
  });

  it("skips commit when nothing is staged after a quiet window", async () => {
    const layout = tempStoreLayout();
    const { driver, gitCalls, triggerChange } = createTestDriver(layout, {
      hasStagedChanges: async () => false,
    });
    driver.start();

    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    await flushAsyncWork();

    expect(gitCalls.filter((call) => call.op === "commit")).toHaveLength(0);
    expect(gitCalls.filter((call) => call.op === "stage")).toHaveLength(1);
    expect(gitCalls.filter((call) => call.op === "push")).toHaveLength(1);
  });

  it("initializes the mirror directory when it is not yet a repository", async () => {
    const layout = tempStoreLayout();
    writeFileSync(join(layout.issuesDir, "seed.txt"), "seed");
    const { driver, gitCalls, triggerChange } = createTestDriver(layout);
    driver.start();

    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    await flushAsyncWork();

    expect(gitCalls.some((call) => call.op === "init")).toBe(true);
    expect(existsSync(join(layout.backupMirrorDir, ".git"))).toBe(true);
  });

  it("writes backup-identity.json at the mirror root when initializing", async () => {
    const layout = tempStoreLayout();
    writeFileSync(join(layout.issuesDir, "seed.txt"), "seed");
    const { driver, triggerChange } = createTestDriver(layout, {
      ensureBackupIdentity,
    });
    driver.start();

    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    await flushAsyncWork();

    const identityPath = join(layout.backupMirrorDir, BACKUP_IDENTITY_FILENAME);
    expect(existsSync(identityPath)).toBe(true);
    expect(
      JSON.parse(readFileSync(identityPath, "utf8")).storeId,
    ).toEqual(expect.any(String));
    expect(
      JSON.parse(readFileSync(identityPath, "utf8")).storeId.length,
    ).toBeGreaterThan(0);
    expect(
      existsSync(join(layout.backupMirrorDir, "issues", BACKUP_IDENTITY_FILENAME)),
    ).toBe(false);
  });

  it("does nothing when backup configuration is disabled", async () => {
    const layout = tempStoreLayout();
    const gitCalls: { op: string; workspace: string }[] = [];
    const { driver, triggerChange } = createTestDriver(layout, {
      readAppConfig: () => ({
        backup: {
          remote: "git@github.com:me/tracker-backup.git",
          enabled: false,
        },
      }),
      initRepository: async (workspace) => {
        gitCalls.push({ op: "init", workspace });
      },
      stageAllChanges: async (workspace) => {
        gitCalls.push({ op: "stage", workspace });
      },
      commitChanges: async (workspace) => {
        gitCalls.push({ op: "commit", workspace });
      },
    });

    driver.start();
    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    await flushAsyncWork();

    expect(gitCalls).toHaveLength(0);
  });

  it("does nothing when backup is unconfigured", async () => {
    const layout = tempStoreLayout();
    const gitCalls: { op: string; workspace: string }[] = [];
    let watcherStarted = false;
    const { driver } = createTestDriver(layout, {
      readAppConfig: () => ({}),
      createWatcher: () => {
        watcherStarted = true;
        return { close: vi.fn() };
      },
      initRepository: async (workspace) => {
        gitCalls.push({ op: "init", workspace });
      },
      stageAllChanges: async (workspace) => {
        gitCalls.push({ op: "stage", workspace });
      },
      commitChanges: async (workspace) => {
        gitCalls.push({ op: "commit", workspace });
      },
    });

    driver.start();
    expect(watcherStarted).toBe(false);
    await driver.takeSnapshot();
    expect(gitCalls).toHaveLength(0);
  });

  it("never invokes git against the store directory", async () => {
    const layout = tempStoreLayout();
    const gitWorkspaces: string[] = [];
    const { driver, triggerChange } = createTestDriver(layout, {
      initRepository: async (workspace) => {
        gitWorkspaces.push(workspace);
        mkdirSync(join(workspace, ".git"), { recursive: true });
      },
      stageAllChanges: async (workspace) => {
        gitWorkspaces.push(workspace);
      },
      hasStagedChanges: async () => true,
      commitChanges: async (workspace) => {
        gitWorkspaces.push(workspace);
      },
      ensureBackupIdentity: () => ({ storeId: "test-store-id" }),
      pushIfAllowed: async (workspace) => {
        gitWorkspaces.push(workspace);
        return "pushed";
      },
    });

    writeFileSync(join(layout.issuesDir, "touch.txt"), "touch");
    driver.start();
    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    await flushAsyncWork();

    expect(gitWorkspaces.every((cwd) => cwd === layout.backupMirrorDir)).toBe(
      true,
    );
    expect(gitWorkspaces).not.toContain(layout.issuesDir);
  });

  it("logs snapshot failures from the debounced callback", async () => {
    const layout = tempStoreLayout();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { driver, triggerChange } = createTestDriver(layout, {
      stageAllChanges: async () => {
        throw new Error("git unavailable");
      },
    });

    driver.start();
    triggerChange();
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DEBOUNCE_MS);
    await flushAsyncWork();

    expect(errorSpy).toHaveBeenCalledWith(
      "store backup snapshot failed:",
      expect.objectContaining({ message: "git unavailable" }),
    );
    errorSpy.mockRestore();
  });
});

describe("takeSnapshot sync", () => {
  it("deletes store files from the mirror copy", async () => {
    const layout = tempStoreLayout();
    const mirrorIssuesDir = join(layout.backupMirrorDir, "issues");
    writeFileSync(join(layout.issuesDir, "remove-me.txt"), "old");
    syncIssuesToMirror(layout.issuesDir, mirrorIssuesDir);
    rmSync(join(layout.issuesDir, "remove-me.txt"));

    const { driver } = createTestDriver(layout, {
      hasStagedChanges: async () => false,
    });
    await driver.takeSnapshot();

    expect(existsSync(join(mirrorIssuesDir, "remove-me.txt"))).toBe(false);
  });
});

describe("formatSnapshotCommitMessage", () => {
  it("uses coarse wording without per-file detail", () => {
    expect(formatSnapshotCommitMessage()).toBe("Snapshot issue store");
  });
});

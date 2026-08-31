import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKUP_STALE_AFTER_MS,
  isBackupStale,
  parseBackupStatus,
  pushWithRetry,
  readBackupStatus,
  writeBackupStatus,
  type BackupEngineStatus,
} from "./store-backup-status.js";

let tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

function tempStatusPath(): string {
  const root = mkdtempSync(join(tmpdir(), "backup-status-"));
  tempRoots.push(root);
  return join(root, "backup-status.json");
}

function seedStatus(path: string, status: BackupEngineStatus): void {
  writeBackupStatus(status, path);
}

describe("pushWithRetry", () => {
  it("retries a transient failure and lands idle on success", async () => {
    const statusPath = tempStatusPath();
    const now = new Date("2026-08-30T19:04:11.000Z");
    let attempts = 0;

    await expect(
      pushWithRetry({
        push: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("Could not resolve hostname");
          }
          return "pushed";
        },
        refusalMessage: () => {
          throw new Error("should not treat a transient failure as divergence");
        },
        statusPath,
        sleep: async () => {},
        now: () => now,
        initialBackoffMs: 100,
      }),
    ).resolves.toBe("pushed");

    expect(attempts).toBe(2);
    expect(readBackupStatus(statusPath)).toEqual({
      lastSuccessAt: "2026-08-30T19:04:11.000Z",
      state: "idle",
      error: null,
    });
    expect(JSON.parse(readFileSync(statusPath, "utf8"))).not.toHaveProperty(
      "stale",
    );
  });

  it("grows backoff across successive transient failures", async () => {
    const statusPath = tempStatusPath();
    const delays: number[] = [];
    let attempts = 0;

    await pushWithRetry({
      push: async () => {
        attempts += 1;
        if (attempts < 4) {
          throw new Error("Connection reset by peer");
        }
        return "pushed";
      },
      refusalMessage: () => {
        throw new Error("should not treat a transient failure as divergence");
      },
      statusPath,
      sleep: async (ms) => {
        delays.push(ms);
      },
      now: () => new Date("2026-08-30T19:04:11.000Z"),
      initialBackoffMs: 100,
      maxBackoffMs: 10_000,
    });

    expect(attempts).toBe(4);
    expect(delays).toEqual([100, 200, 400]);
  });

  it("does not retry a divergence refusal", async () => {
    const statusPath = tempStatusPath();
    seedStatus(statusPath, {
      lastSuccessAt: "2026-08-29T12:00:00.000Z",
      state: "idle",
      error: null,
    });
    let attempts = 0;
    const delays: number[] = [];
    const message =
      "Remote store identity differs from this machine (local a, remote b)";

    await expect(
      pushWithRetry({
        push: async () => {
          attempts += 1;
          return "refused";
        },
        refusalMessage: () => message,
        statusPath,
        sleep: async (ms) => {
          delays.push(ms);
        },
        now: () => new Date("2026-08-30T19:04:11.000Z"),
        initialBackoffMs: 100,
      }),
    ).resolves.toBe("refused");

    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
    expect(readBackupStatus(statusPath)).toEqual({
      lastSuccessAt: "2026-08-29T12:00:00.000Z",
      state: "diverged",
      error: message,
    });
  });

  it("records git's text verbatim on a transient failure", async () => {
    const statusPath = tempStatusPath();
    const priorSuccess = "2026-08-29T12:00:00.000Z";
    seedStatus(statusPath, {
      lastSuccessAt: priorSuccess,
      state: "idle",
      error: null,
    });
    const gitText = "error: failed to push some refs\n ! [rejected] main -> main";
    let recorded: BackupEngineStatus | null = null;
    let attempts = 0;

    await pushWithRetry({
      push: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(gitText);
        }
        return "pushed";
      },
      refusalMessage: () => {
        throw new Error("should not treat a transient failure as divergence");
      },
      statusPath,
      sleep: async () => {
        recorded = readBackupStatus(statusPath);
      },
      now: () => new Date("2026-08-30T19:04:11.000Z"),
      initialBackoffMs: 50,
    });

    expect(recorded).toEqual({
      lastSuccessAt: priorSuccess,
      state: "retrying",
      error: gitText,
    });
    expect(readBackupStatus(statusPath).error).toBeNull();
  });
});

describe("isBackupStale", () => {
  const now = new Date("2026-08-31T00:00:00.000Z");

  it("is false just inside the 24-hour threshold and true just outside", () => {
    const inside = new Date(now.getTime() - BACKUP_STALE_AFTER_MS + 1).toISOString();
    const outside = new Date(now.getTime() - BACKUP_STALE_AFTER_MS - 1).toISOString();

    expect(isBackupStale(inside, now)).toBe(false);
    expect(isBackupStale(outside, now)).toBe(true);
    expect(isBackupStale(null, now)).toBe(true);
  });
});

describe("readBackupStatus", () => {
  it("returns idle with a null last success when the file is absent", () => {
    const statusPath = tempStatusPath();
    expect(readBackupStatus(statusPath)).toEqual({
      lastSuccessAt: null,
      state: "idle",
      error: null,
    });
  });
});

describe("parseBackupStatus", () => {
  it("raises on a file that stores derived staleness instead of engine state", () => {
    expect(() =>
      parseBackupStatus(
        JSON.stringify({
          lastSuccessAt: "2026-08-30T19:04:11.000Z",
          stale: true,
          error: null,
        }),
      ),
    ).toThrow(/missing required fields/);
  });
});

describe("writeBackupStatus", () => {
  it("writes the engine record without a stored stale flag", () => {
    const statusPath = tempStatusPath();
    writeBackupStatus(
      {
        lastSuccessAt: "2026-08-30T19:04:11.000Z",
        state: "idle",
        error: null,
      },
      statusPath,
    );
    expect(JSON.parse(readFileSync(statusPath, "utf8"))).toEqual({
      lastSuccessAt: "2026-08-30T19:04:11.000Z",
      state: "idle",
      error: null,
    });
    writeFileSync(statusPath, "{");
    expect(() => readBackupStatus(statusPath)).toThrow(/not valid JSON/);
  });
});

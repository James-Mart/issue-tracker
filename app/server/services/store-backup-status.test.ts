import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  pushWithRetry,
  readBackupStatus,
  writeBackupStatus,
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

describe("pushWithRetry", () => {
  it("does not retry a divergence refusal", async () => {
    const statusPath = tempStatusPath();
    writeBackupStatus(
      {
        lastSuccessAt: "2026-08-29T12:00:00.000Z",
        state: "idle",
        error: null,
      },
      statusPath,
    );
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
});

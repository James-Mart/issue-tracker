import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindWorkQueueDisk } from "./queue-launcher.test-helpers.js";

let rootDir: string;
let issuesDir: string;
const disk = bindWorkQueueDisk();
const { seedProject, seedEpic, readRaw } = disk;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-dequeue-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  disk.setDir(issuesDir);
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(rootDir, { recursive: true, force: true });
});

async function load() {
  return import("./dequeue-work-root.js");
}

describe("dequeueWorkRoot", () => {
  it("clears queue fields on a waiting root", async () => {
    seedProject();
    seedEpic("waiting", 1, {
      workQueuedAt: "2026-07-01T00:00:00.000Z",
      workQueuePosition: 1,
    });
    const { dequeueWorkRoot } = await load();

    const root = await dequeueWorkRoot("waiting");

    expect(root.id).toBe("waiting");
    expect(root.kind).toBe("epic");
    if (root.kind !== "epic") throw new Error("expected epic");
    expect(root.workQueuedAt).toBeUndefined();
    expect(root.workQueuePosition).toBeUndefined();
    expect(readRaw("waiting").workQueuedAt).toBeUndefined();
    expect(readRaw("waiting").workQueuePosition).toBeUndefined();
  });
});

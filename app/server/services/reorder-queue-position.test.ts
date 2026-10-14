import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindWorkQueueDisk } from "./queue-launcher.test-helpers.js";

let rootDir: string;
let issuesDir: string;
const disk = bindWorkQueueDisk();
const { seedProject, seedEpic, readRaw } = disk;

const queued = (position: number, fields: Record<string, unknown> = {}) => ({
  workQueuedAt: "2026-07-01T00:00:00.000Z",
  workQueuePosition: position,
  ...fields,
});

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-reorder-queue-"));
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
  return import("./reorder-queue-position.js");
}

describe("reorderQueuePosition", () => {
  it("moves a waiting root and returns the project's waiting order", async () => {
    seedProject();
    seedEpic("first", 1, queued(1));
    seedEpic("second", 2, queued(2));
    seedEpic("third", 3, queued(3));
    mkdirSync(join(issuesDir, "q"), { recursive: true });
    writeFileSync(
      join(issuesDir, "q", "issue.json"),
      JSON.stringify({
        id: "q",
        kind: "project",
        title: "Q",
        order: 1,
        workspace: "/tmp/other",
        maxImplementingRuns: 1,
        createdAt: "2026-07-09T14:00:00.000Z",
        updatedAt: "2026-07-09T14:00:00.000Z",
      }),
    );
    seedEpic("foreign", 1, { partOf: "q", ...queued(1) });
    const { reorderQueuePosition } = await load();

    const result = await reorderQueuePosition("third", 0);

    expect(result.order).toEqual(["third", "first", "second"]);
    expect(readRaw("third").workQueuePosition).toBe(1);
    expect(readRaw("first").workQueuePosition).toBe(2);
    expect(readRaw("second").workQueuePosition).toBe(3);
    expect(readRaw("foreign").workQueuePosition).toBe(1);
  });
});

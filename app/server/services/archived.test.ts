import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";

describe("archived on-disk (migration + cascade/create)", () => {
  let dir: string;

  function writeIssue(id: string, body: Record<string, unknown>): void {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
  }

  function readIssue(id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  }

  function seedTree(opts: { withArchivedDefaults?: boolean } = {}): void {
    const defaults = opts.withArchivedDefaults
      ? {
          needsAttention: false,
          attentionReason: null,
          archived: false,
        }
      : {};
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("e", {
      kind: "epic",
      title: "E",
      partOf: "p",
      blockedBy: [],
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      ...defaults,
    });
    writeIssue("b", {
      kind: "story",
      title: "B",
      partOf: "e",
      merged: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      ...defaults,
    });
    writeIssue("c", {
      kind: "task",
      title: "C",
      partOf: "b",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
      ...defaults,
    });
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-archived-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("cascades archive and unarchive through descendants", async () => {
    seedTree({ withArchivedDefaults: true });
    const { update } = await import("./issues.js");
    await update("e", { archived: true });
    expect(readIssue("e").archived).toBe(true);
    expect(readIssue("b").archived).toBe(true);
    expect(readIssue("c").archived).toBe(true);

    await update("e", { archived: false });
    expect(readIssue("e").archived).toBe(false);
    expect(readIssue("b").archived).toBe(false);
    expect(readIssue("c").archived).toBe(false);
  });
});

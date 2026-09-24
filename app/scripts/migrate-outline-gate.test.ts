import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function writeIdea(
  root: string,
  id: string,
  body: Record<string, unknown>,
): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(
    join(root, id, "issue.json"),
    `${JSON.stringify({ id, kind: "idea", partOf: "project-a", ...body })}\n`,
  );
}

function writeTask(root: string, id: string): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(
    join(root, id, "issue.json"),
    `${JSON.stringify({ id, kind: "task", partOf: "story-a" })}\n`,
  );
}

describe("migrateOutlineGate", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-migrate-outline-gate-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites approvePlan, preserves migrated and untouched ideas, and no-ops on rerun", async () => {
    writeIdea(dir, "legacy", { approvePlan: true, title: "Legacy" });
    writeIdea(dir, "migrated", { outlineGate: false, title: "Already migrated" });
    writeIdea(dir, "empty", { title: "No gate" });
    writeTask(dir, "task-a");
    mkdirSync(join(dir, "corrupt"), { recursive: true });
    writeFileSync(join(dir, "corrupt", "issue.json"), "{not json\n");

    const { migrateOutlineGate } = await import("./migrate-outline-gate.js");
    const first = migrateOutlineGate();

    expect(first.ideasProcessed).toBe(3);
    expect(first.ideasMigrated).toBe(1);

    const legacy = JSON.parse(
      readFileSync(join(dir, "legacy", "issue.json"), "utf8"),
    );
    expect(legacy.outlineGate).toBe(true);
    expect(legacy).not.toHaveProperty("approvePlan");
    expect(legacy.title).toBe("Legacy");

    const migrated = JSON.parse(
      readFileSync(join(dir, "migrated", "issue.json"), "utf8"),
    );
    expect(migrated.outlineGate).toBe(false);
    expect(migrated).not.toHaveProperty("approvePlan");

    const empty = JSON.parse(
      readFileSync(join(dir, "empty", "issue.json"), "utf8"),
    );
    expect(empty).not.toHaveProperty("outlineGate");
    expect(empty).not.toHaveProperty("approvePlan");

    const second = migrateOutlineGate();
    expect(second.ideasMigrated).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "legacy", "issue.json"), "utf8"))).toEqual(
      legacy,
    );
  });
});

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

const VALID_SHA = "deadbeef00000000000000000000000000000000";
const MIGRATED_COMMITS = ["0123456789abcdef0123456789abcdef01234567"];

function writeTask(
  root: string,
  id: string,
  body: Record<string, unknown>,
): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(
    join(root, id, "issue.json"),
    `${JSON.stringify({ id, kind: "task", partOf: "story-a", ...body })}\n`,
  );
}

function writeStory(root: string, id: string): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(
    join(root, id, "issue.json"),
    `${JSON.stringify({ id, kind: "story", partOf: "epic-a" })}\n`,
  );
}

describe("migrateTaskCommits", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-migrate-task-commits-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites commitSha, preserves migrated and untouched tasks, reports malformed sha, and no-ops on rerun", async () => {
    writeTask(dir, "legacy", { commitSha: VALID_SHA, status: "done" });
    writeTask(dir, "migrated", { commits: MIGRATED_COMMITS, status: "done" });
    writeTask(dir, "empty", { status: "todo" });
    writeTask(dir, "bad-sha", { commitSha: "not-a-full-sha", status: "done" });
    mkdirSync(join(dir, "corrupt"), { recursive: true });
    writeFileSync(join(dir, "corrupt", "issue.json"), "{not json\n");
    writeStory(dir, "story-a");

    const { migrateTaskCommits } = await import("./migrate-task-commits.js");
    const first = migrateTaskCommits();

    expect(first.tasksProcessed).toBe(4);
    expect(first.tasksMigrated).toBe(1);
    expect(first.malformed).toHaveLength(2);
    expect(first.malformed.some((m) => m.file.includes("bad-sha/issue.json"))).toBe(
      true,
    );
    expect(first.malformed.some((m) => m.file.includes("corrupt/issue.json"))).toBe(
      true,
    );

    const legacy = JSON.parse(readFileSync(join(dir, "legacy", "issue.json"), "utf8"));
    expect(legacy.commits).toEqual([VALID_SHA]);
    expect(legacy).not.toHaveProperty("commitSha");
    expect(legacy.status).toBe("done");

    const migrated = JSON.parse(
      readFileSync(join(dir, "migrated", "issue.json"), "utf8"),
    );
    expect(migrated.commits).toEqual(MIGRATED_COMMITS);
    expect(migrated).not.toHaveProperty("commitSha");

    const empty = JSON.parse(readFileSync(join(dir, "empty", "issue.json"), "utf8"));
    expect(empty).not.toHaveProperty("commits");
    expect(empty).not.toHaveProperty("commitSha");

    const badSha = JSON.parse(readFileSync(join(dir, "bad-sha", "issue.json"), "utf8"));
    expect(badSha.commitSha).toBe("not-a-full-sha");
    expect(badSha).not.toHaveProperty("commits");

    const second = migrateTaskCommits();
    expect(second.tasksMigrated).toBe(0);
    expect(second.malformed).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(dir, "legacy", "issue.json"), "utf8"))).toEqual(
      legacy,
    );
  });
});

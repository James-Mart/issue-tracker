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

const AT = "2026-07-09T14:00:00.000Z";
const LEGACY_LINE = `{"role":"agent","body":"legacy","at":"${AT}"}`;
const MIGRATED_LINE =
  '{"role":"implementor","body":"already migrated","id":"00000000-0000-4000-8000-000000000001","at":"2026-07-09T15:00:00.000Z"}';
const MALFORMED_LINE = '{"role":"agent","body":""}';

describe("migrateCommentIds", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-migrate-comment-ids-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds ids to legacy lines, preserves migrated and malformed lines, and no-ops on rerun", async () => {
    mkdirSync(join(dir, "issue-a"), { recursive: true });
    const commentsPath = join(dir, "issue-a", "comments.jsonl");
    writeFileSync(
      commentsPath,
      `${LEGACY_LINE}\n${MIGRATED_LINE}\n${MALFORMED_LINE}\n`,
    );

    const { migrateCommentIds } = await import("./migrate-comment-ids.js");
    const first = migrateCommentIds();
    const afterFirst = readFileSync(commentsPath, "utf8");

    expect(first.linesMigrated).toBe(1);
    expect(first.malformed).toHaveLength(1);
    expect(first.malformed[0]?.line).toBe(3);

    const firstLines = afterFirst.split("\n").filter((line) => line.length > 0);
    expect(firstLines).toHaveLength(3);
    expect(firstLines[0]).not.toBe(LEGACY_LINE);
    expect(JSON.parse(firstLines[0]!).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(JSON.parse(firstLines[0]!).role).toBe("agent");
    expect(JSON.parse(firstLines[0]!).body).toBe("legacy");
    expect(JSON.parse(firstLines[0]!).at).toBe(AT);
    expect(firstLines[1]).toBe(MIGRATED_LINE);
    expect(firstLines[2]).toBe(MALFORMED_LINE);

    const second = migrateCommentIds();
    const afterSecond = readFileSync(commentsPath, "utf8");

    expect(second.linesMigrated).toBe(0);
    expect(second.malformed).toHaveLength(1);
    expect(afterSecond).toBe(afterFirst);
  });
});

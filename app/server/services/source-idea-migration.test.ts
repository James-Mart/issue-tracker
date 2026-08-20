import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-01-01T00:00:00.000Z";

describe("sourceIdea description-line migration", () => {
  let dir: string;

  function writeIssue(
    id: string,
    body: Record<string, unknown>,
    description?: string,
  ): void {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
    if (description !== undefined) {
      writeFileSync(join(dir, id, "description.md"), description);
    }
  }

  function readIssue(id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  }

  function readDescription(id: string): string {
    return readFileSync(join(dir, id, "description.md"), "utf8");
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-source-idea-migration-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes sourceIdea, strips the line, skips bad links, and no-ops on rerun", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      order: 0,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue(
      "conforming-root",
      {
        kind: "epic",
        title: "Conforming",
        partOf: "platform",
        blockedBy: [],
        order: 0,
        needsAttention: false,
        attentionReason: null,
        archived: false,
        createdAt: AT,
        updatedAt: AT,
      },
      "Source idea: [Capture](issue:capture)\n\n# Plan\n",
    );
    writeIssue(
      "bad-link-root",
      {
        kind: "epic",
        title: "Bad link",
        partOf: "platform",
        blockedBy: [],
        order: 1,
        needsAttention: false,
        attentionReason: null,
        archived: false,
        createdAt: AT,
        updatedAt: AT,
      },
      "Source idea: [Task](issue:some-task)\n\n# Plan\n",
    );
    writeIssue("some-task", {
      kind: "task",
      title: "Some task",
      partOf: "conforming-root",
      status: "todo",
      order: 0,
      needsAttention: false,
      attentionReason: null,
      archived: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("already-converted", {
      kind: "epic",
      title: "Converted",
      partOf: "platform",
      blockedBy: [],
      order: 2,
      needsAttention: false,
      attentionReason: null,
      archived: false,
      sourceIdea: "capture",
      createdAt: AT,
      updatedAt: AT,
    }, "# Already converted\n");

    const { ensureSourceIdeaMigrated } = await import("./source-idea-migration.js");
    const first = ensureSourceIdeaMigrated();
    expect(first.skipped).toBe(false);
    expect(first.updated).toEqual(["conforming-root"]);
    expect(readIssue("conforming-root").sourceIdea).toBe("capture");
    expect(readDescription("conforming-root")).toBe("# Plan\n");
    expect(readIssue("bad-link-root").sourceIdea).toBeUndefined();
    expect(readDescription("bad-link-root")).toBe(
      "Source idea: [Task](issue:some-task)\n\n# Plan\n",
    );
    expect(readIssue("already-converted").sourceIdea).toBe("capture");
    expect(readDescription("already-converted")).toBe("# Already converted\n");
    expect(existsSync(join(dir, ".source-idea-migrated"))).toBe(true);

    const second = ensureSourceIdeaMigrated();
    expect(second.skipped).toBe(true);
    expect(second.updated).toEqual([]);
    expect(readIssue("conforming-root").sourceIdea).toBe("capture");
    expect(readDescription("conforming-root")).toBe("# Plan\n");
  });
});

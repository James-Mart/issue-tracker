import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const AT = "2024-01-01T00:00:00.000Z";

describe("kind rename migration", () => {
  let dir: string;

  function writeIssue(id: string, body: Record<string, unknown>): void {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
  }

  function readIssue(id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-kind-rename-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites branch→story and commit→task once, then no-ops", async () => {
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
      needsAttention: false,
      attentionReason: null,
      archived: true,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("b", {
      kind: "branch",
      title: "B",
      partOf: "e",
      merged: false,
      needsAttention: false,
      attentionReason: null,
      archived: true,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("c", {
      kind: "commit",
      title: "C",
      partOf: "b",
      status: "todo",
      needsAttention: false,
      attentionReason: null,
      archived: true,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { list } = await import("./issues.js");
    const first = list();
    expect(readIssue("b").kind).toBe("story");
    expect(readIssue("c").kind).toBe("task");
    // archived is carried across the kind rewrite
    expect(readIssue("b").archived).toBe(true);
    expect(readIssue("c").archived).toBe(true);
    expect(first.issues.find((i) => i.id === "b")?.kind).toBe("story");
    expect(first.issues.find((i) => i.id === "c")?.kind).toBe("task");
    expect(existsSync(join(dir, ".kind-renamed-story-task"))).toBe(true);

    // Second list does not re-touch files (marker present); kinds stay new.
    writeIssue("legacy", {
      kind: "branch",
      title: "post-marker",
      partOf: "e",
      merged: false,
      needsAttention: false,
      attentionReason: null,
      archived: false,
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    list();
    // After cutover, dual-read is gone: a fresh branch kind is not migrated.
    expect(readIssue("legacy").kind).toBe("branch");
  });

  it("withholds the marker when an id/dir mismatch blocks rewrite", async () => {
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    // Directory name "drift" but issue.json id is "other" — rewrite skipped.
    mkdirSync(join(dir, "drift"), { recursive: true });
    writeFileSync(
      join(dir, "drift", "issue.json"),
      JSON.stringify({
        id: "other",
        kind: "branch",
        title: "Drifted",
        partOf: "p",
        merged: false,
        needsAttention: false,
        attentionReason: null,
        archived: false,
        order: 0,
        createdAt: AT,
        updatedAt: AT,
      }),
    );

    const { ensureKindRenamed } = await import("./kind-rename.js");
    const result = ensureKindRenamed();
    expect(result.incompleteReason).toMatch(/still have kind branch\|commit/);
    expect(existsSync(join(dir, ".kind-renamed-story-task"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(dir, "drift", "issue.json"), "utf8")).kind,
    ).toBe("branch");
  });

  it("withholds the marker when issue.json is unreadable without throwing", async () => {
    mkdirSync(join(dir, "bad"), { recursive: true });
    writeFileSync(join(dir, "bad", "issue.json"), "{not-json");

    const { ensureKindRenamed } = await import("./kind-rename.js");
    const result = ensureKindRenamed();
    expect(result.incompleteReason).toMatch(/unreadable issue\.json/);
    expect(existsSync(join(dir, ".kind-renamed-story-task"))).toBe(false);
  });
});

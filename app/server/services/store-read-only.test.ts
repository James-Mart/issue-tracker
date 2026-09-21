import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let issuesDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-store-read-only-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function seedIssue(
  id: string,
  body: Record<string, unknown>,
): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    `${JSON.stringify({ id, ...body }, null, 2)}\n`,
  );
}

function seedProject(id: string): void {
  seedIssue(id, {
    kind: "project",
    title: "Demo",
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("ISSUE_TRACKER_STORE_READ_ONLY", () => {
  it("allows reads and refuses create without changing the store", async () => {
    seedProject("demo");
    const before = readdirSync(issuesDir).sort();

    const { list, create } = await import("./issues.js");
    const { IssueError } = await import("./errors.js");

    expect(list().issues.map((issue) => issue.id)).toEqual(["demo"]);

    await expect(
      create({ kind: "idea", title: "New", partOf: "demo" }),
    ).rejects.toMatchObject({
      code: "read_only",
      status: 403,
    });

    expect(readdirSync(issuesDir).sort()).toEqual(before);
    expect(existsSync(join(issuesDir, "new"))).toBe(false);
  });

  it("refuses remove without deleting directories when no survivor patches are needed", async () => {
    seedProject("demo");
    seedIssue("leaf-idea", {
      kind: "idea",
      title: "Leaf",
      partOf: "demo",
      order: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const before = readdirSync(issuesDir).sort();

    const { remove } = await import("./issues.js");

    await expect(remove("leaf-idea")).rejects.toMatchObject({
      code: "read_only",
      status: 403,
    });

    expect(readdirSync(issuesDir).sort()).toEqual(before);
    expect(existsSync(join(issuesDir, "leaf-idea"))).toBe(true);
  });
});

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

  it("runs migrations and accepts writes when guest is set beside read-only", async () => {
    vi.stubEnv("ISSUE_TRACKER_GUEST", "1");
    vi.resetModules();
    seedProject("demo");

    const { list, create } = await import("./issues.js");
    list();
    expect(existsSync(join(issuesDir, ".source-idea-migrated"))).toBe(true);

    await expect(
      create({ kind: "idea", title: "New", partOf: "demo" }),
    ).resolves.toMatchObject({ id: "new", kind: "idea" });
  });
});

describe("two-phase read-only", () => {
  async function load(readOnly: string, guest: string) {
    vi.resetModules();
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", readOnly);
    vi.stubEnv("ISSUE_TRACKER_GUEST", guest);
    return import("./store-read-only.js");
  }

  it.each([
    ["", "", false, false, true],
    ["1", "", true, true, false],
    ["", "1", false, true, true],
    ["1", "1", false, true, true],
  ] as const)(
    "read-only %j guest %j refuses %s skips %s writable %s",
    async (readOnly, guest, refuses, skips, writable) => {
      const mod = await load(readOnly, guest);
      expect(mod.refusesStoreWrites()).toBe(refuses);
      expect(mod.skipsGuestDuties()).toBe(skips);
      if (writable) {
        expect(() => mod.assertStoreWritable()).not.toThrow();
      } else {
        expect(() => mod.assertStoreWritable()).toThrow(
          expect.objectContaining({ code: "read_only", status: 403 }),
        );
      }
    },
  );
});

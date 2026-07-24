import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: unknown): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(
    join(dir, id, "issue.json"),
    typeof body === "string" ? body : JSON.stringify(body),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-list-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadList() {
  const mod = await import("./issues.js");
  return mod.list;
}

describe("list() malformed filter", () => {
  it("excludes malformed dirs, surfaces problems, and never crashes", async () => {
    writeIssue("proj", {
      id: "proj",
      kind: "project",
      title: "Proj",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("good-epic", {
      id: "good-epic",
      kind: "epic",
      title: "Good",
      partOf: "proj",
      createdAt: AT,
      updatedAt: AT,
    });
    mkdirSync(join(dir, "no-json"), { recursive: true });
    writeIssue("bad-json", "{ not valid json");
    writeIssue("mismatch", {
      id: "other-id",
      kind: "epic",
      title: "Mismatch",
      partOf: "proj",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("dangling", {
      id: "dangling",
      kind: "story",
      title: "Dangling",
      partOf: "ghost",
      createdAt: AT,
      updatedAt: AT,
    });

    const list = await loadList();
    const result = list();

    const ids = result.issues.map((issue) => issue.id).sort();
    expect(ids).toEqual(["dangling", "good-epic", "mismatch", "proj"]);

    const problems = result.problems;
    const find = (id: string) => problems.filter((p) => p.id === id);

    expect(find("no-json")[0]?.message).toContain("missing issue.json");
    expect(find("bad-json")[0]?.message).toContain("invalid issue.json");
    expect(find("mismatch")[0]?.message).toContain(
      "does not match directory name",
    );
    expect(find("dangling")[0]?.message).toContain("unknown issue");
  });

  it("returns empty when the issues dir is absent", async () => {
    const missing = join(dir, "nope");
    vi.stubEnv("ISSUES_DIR", missing);
    vi.resetModules();
    const list = await loadList();
    expect(list()).toEqual({ issues: [], problems: [], derived: {} });
  });
});

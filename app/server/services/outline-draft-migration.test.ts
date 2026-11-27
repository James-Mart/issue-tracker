import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function writeOutline(id: string): void {
  writeIssue(id, {
    kind: "outline",
    title: id,
    partOf: "p",
    bodyVersion: 1,
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-outline-draft-migration-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("discardUnownedOutlineDrafts", () => {
  it("discards a legacy draft and keeps a review-owned one", async () => {
    writeOutline("legacy");
    writeFileSync(join(dir, "legacy", "draft.md"), "old\n");
    writeFileSync(
      join(dir, "legacy", "draft-predated.json"),
      `${JSON.stringify({ predated: [] })}\n`,
    );
    writeOutline("owned");
    const owned = `${JSON.stringify(
      { body: "next\n", review: "review", submission: "sub" },
      null,
      2,
    )}\n`;
    writeFileSync(join(dir, "owned", "draft.json"), owned);
    writeFileSync(join(dir, "owned", "draft.md"), "stray\n");

    const { discardUnownedOutlineDrafts } = await import("./outline-draft-migration.js");
    expect(discardUnownedOutlineDrafts().sort()).toEqual(["legacy", "owned"]);
    expect(existsSync(join(dir, "legacy", "draft.md"))).toBe(false);
    expect(existsSync(join(dir, "legacy", "draft-predated.json"))).toBe(false);
    expect(readFileSync(join(dir, "owned", "draft.json"), "utf8")).toBe(owned);
    expect(existsSync(join(dir, "owned", "draft.md"))).toBe(false);

    expect(discardUnownedOutlineDrafts()).toEqual([]);
  });
});
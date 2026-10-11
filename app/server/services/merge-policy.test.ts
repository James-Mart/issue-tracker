import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-merge-policy-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function loadService() {
  return import("./issues.js");
}

describe("project mergePolicy", () => {
  it("accepts mergePolicy on a story and inherits when unset", async () => {
    writeIssue("e", {
      kind: "epic",
      title: "E",
      partOf: "p",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("s", {
      kind: "story",
      title: "S",
      partOf: "e",
      order: 0,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { update, list } = await loadService();
    await update("p", { mergePolicy: "merge" });
    expect(list().derived.s?.mergePolicy).toBe("merge");
    await update("s", { mergePolicy: "manual" });
    expect(list().derived.s?.mergePolicy).toBe("manual");
  });
});

describe("mergePolicy ceiling", () => {
  it("rejects raising a trunk Story above the Project ceiling", async () => {
    writeIssue("s", {
      kind: "story",
      title: "S",
      partOf: "p",
      order: 0,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    const { update } = await loadService();
    await update("p", { mergePolicy: "pull-request" });
    await expect(update("s", { mergePolicy: "merge" })).rejects.toThrow(
      /mergePolicy "merge" exceeds ceiling "pull-request" from parent "p"/,
    );
    const raw = JSON.parse(readFileSync(join(dir, "s", "issue.json"), "utf8"));
    expect(raw).not.toHaveProperty("mergePolicy");
  });
});

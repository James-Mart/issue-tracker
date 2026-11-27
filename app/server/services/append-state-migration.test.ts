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

function readIssue(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-append-state-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("ensureAppendStateCleared", () => {
  it("clears appendTo on Ideas and stored appendLock, then no-ops", async () => {
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      order: 1,
      appendTo: "open-story",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("spec", {
      kind: "outline",
      title: "Spec",
      partOf: "p",
      bodyVersion: 1,
      appendLock: { ideaId: "capture", ideaTitle: "Capture" },
      order: 2,
      createdAt: AT,
      updatedAt: AT,
    });
    const before = readFileSync(join(dir, "p", "issue.json"), "utf8");

    const { ensureAppendStateCleared } = await import("./append-state-migration.js");
    const first = ensureAppendStateCleared();
    expect(first.updated.sort()).toEqual(["capture", "spec"]);
    expect(readIssue("capture").appendTo).toBeUndefined();
    expect(readIssue("spec").appendLock).toBeUndefined();
    expect(readIssue("spec").bodyVersion).toBe(1);
    expect(readFileSync(join(dir, "p", "issue.json"), "utf8")).toBe(before);

    expect(ensureAppendStateCleared().updated).toEqual([]);
  });
});

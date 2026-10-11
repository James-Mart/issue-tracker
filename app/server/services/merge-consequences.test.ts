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

function readStoryJson(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-merge-consequences-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
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
    order: 0,
    blockedBy: [],
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("update merged flip cascade", () => {
  it("flags a started sibling on the landed base and leaves not-started and empty-branch siblings untouched", async () => {
    writeIssue("finisher", {
      kind: "story",
      title: "Finisher",
      partOf: "e",
      order: 0,
      branchName: "feat/finisher",
      prUrl: "https://github.com/acme/widgets/pull/1",
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("sibling", {
      kind: "story",
      title: "Sibling",
      partOf: "e",
      order: 1,
      branchName: "feat/sibling",
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("not-started", {
      kind: "story",
      title: "Not started",
      partOf: "e",
      order: 2,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("no-branch", {
      kind: "story",
      title: "No branch",
      partOf: "e",
      order: 3,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("task-on-no-branch", {
      kind: "task",
      title: "Task",
      partOf: "no-branch",
      order: 0,
      status: "done",
      createdAt: AT,
      updatedAt: AT,
    });

    const { update, list } = await import("./issues.js");
    await update("finisher", { merged: true });

    expect(readStoryJson("finisher").merged).toBe(true);
    expect(readStoryJson("sibling").needsRebase).toBe("main");
    expect(readStoryJson("not-started").needsRebase).toBeUndefined();
    expect(readStoryJson("no-branch").needsRebase).toBeUndefined();
    expect(list().derived.sibling?.mergeBase).toBe("main");
  });
});

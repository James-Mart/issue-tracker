import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../schemas.js";

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

async function loadModules() {
  const consequences = await import("./merge-consequences.js");
  const issues = await import("./issues.js");
  return { ...consequences, list: issues.list };
}

describe("staleSiblingIds", () => {
  it("flags a started sibling on the landed base but not not-started or other-base stories", async () => {
    writeIssue("parent", {
      kind: "story",
      title: "Parent",
      partOf: "e",
      order: 0,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("finisher", {
      kind: "story",
      title: "Finisher",
      partOf: "e",
      order: 1,
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
      order: 2,
      branchName: "feat/sibling",
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("not-started", {
      kind: "story",
      title: "Not started",
      partOf: "e",
      order: 3,
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("other-base", {
      kind: "story",
      title: "Other base",
      partOf: "e",
      order: 4,
      stackedOn: "parent",
      branchName: "feat/other",
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });

    const { staleSiblingIds, landedBaseForMerge, list } = await loadModules();
    const { issues } = list();
    const landedBase = landedBaseForMerge("finisher", issues as Issue[]);
    expect(landedBase).toBe("main");

    const stale = staleSiblingIds(issues as Issue[], "finisher", landedBase!);
    expect(stale).toEqual(["sibling"]);
  });
});

describe("applyMergeConsequences", () => {
  it("sets merged and flags stale siblings without writing child mergeBase", async () => {
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
    writeIssue("child", {
      kind: "story",
      title: "Child",
      partOf: "e",
      order: 3,
      stackedOn: "finisher",
      branchName: "feat/child",
      merged: false,
      createdAt: AT,
      updatedAt: AT,
    });

    const { applyMergeConsequences, list } = await loadModules();
    await applyMergeConsequences("finisher");

    expect(readStoryJson("finisher").merged).toBe(true);
    expect(readStoryJson("sibling").needsRebase).toBe("main");
    expect(readStoryJson("not-started").needsRebase).toBeUndefined();
    expect(readStoryJson("child").mergeBase).toBeUndefined();
    expect(readStoryJson("child").needsRebase).toBe("main");
    expect(list().derived.child?.mergeBase).toBe("main");
  });
});

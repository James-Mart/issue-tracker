import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EPIC_BASE,
  branchNameRenameError,
  stackedChildren,
} from "./merge-base";
import type { Issue } from "../schemas";

const AT = "2026-07-09T14:00:00.000Z";

function branch(
  id: string,
  extra: Partial<Extract<Issue, { kind: "story" }>> = {},
): Issue {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "e",
    order: 0,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  };
}

describe("branchName rename guard", () => {
  it("lists direct stacked children only", () => {
    const issues = [
      branch("parent"),
      branch("child", { stackedOn: "parent" }),
      branch("grand", { stackedOn: "child" }),
      branch("other", { stackedOn: "other-parent" }),
    ];
    expect(stackedChildren("parent", issues).map((c) => c.id)).toEqual([
      "child",
    ]);
  });

  it("allows same-value branchName with stacked children", () => {
    const existing = branch("parent", { branchName: "feat/parent" });
    const issues = [existing, branch("child", { stackedOn: "parent" })];
    expect(
      branchNameRenameError(existing, { branchName: "feat/parent" }, issues),
    ).toBeNull();
  });

  it("refuses a real rename with stacked children", () => {
    const existing = branch("parent", { branchName: "feat/parent" });
    const issues = [existing, branch("child", { stackedOn: "parent" })];
    expect(
      branchNameRenameError(existing, { branchName: "feat/other" }, issues),
    ).toMatch(/cannot change branchName.*"parent".*child/);
  });
});

describe("ensureMergeBaseStripped (via list)", () => {
  let dir: string;

  function writeIssue(id: string, body: Record<string, unknown>): void {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
  }

  function readIssue(id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-merge-base-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
    writeIssue("p", { kind: "project", title: "P", order: 0, createdAt: AT, updatedAt: AT });
    writeIssue("e", {
      kind: "epic",
      title: "E",
      partOf: "p",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("strips stored mergeBase once and never writes it again", async () => {
    writeIssue("root", {
      kind: "story",
      title: "Root",
      partOf: "e",
      branchName: "feat/root",
      mergeBase: "main",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("child-named", {
      kind: "story",
      title: "Child named parent",
      partOf: "e",
      stackedOn: "root",
      mergeBase: "feat/root",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("child-unnamed", {
      kind: "story",
      title: "Child unnamed parent",
      partOf: "e",
      stackedOn: "orphan-parent",
      mergeBase: "stale",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("orphan-parent", {
      kind: "story",
      title: "Unnamed root",
      partOf: "e",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });

    const { list } = await import("./issues.js");
    const first = list();

    expect(readIssue("root").mergeBase).toBeUndefined();
    expect(readIssue("child-named").mergeBase).toBeUndefined();
    expect(readIssue("child-unnamed").mergeBase).toBeUndefined();
    expect(first.derived.root?.mergeBase).toBe(EPIC_BASE);
    expect(first.derived["child-named"]?.mergeBase).toBe("feat/root");
    expect(first.derived["child-unnamed"]?.mergeBase).toBeUndefined();

    writeIssue("fresh-child", {
      kind: "story",
      title: "Fresh",
      partOf: "e",
      stackedOn: "root",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    list();
    expect(readIssue("fresh-child").mergeBase).toBeUndefined();
    expect(list().derived["fresh-child"]?.mergeBase).toBe("feat/root");
  });
});

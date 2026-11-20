import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let rootDir: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

function readIssue(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(issuesDir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-pending-appends-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: "/tmp/repo",
    mergePolicy: "merge",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("amend", {
    kind: "idea",
    title: "Amend",
    partOf: "p",
    appendTo: "target",
    archived: true,
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("spec", {
    kind: "outline",
    title: "Spec",
    partOf: "p",
    bodyVersion: 2,
    executionGate: true,
    codeApprovalRequired: false,
    pendingAppends: [
      {
        targetStory: "target",
        sourceIdea: "amend",
        executionGate: false,
        codeApprovalRequired: true,
      },
    ],
    order: 2,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("root", {
    kind: "epic",
    title: "Root",
    partOf: "p",
    sourceOutline: { outline: "spec", version: 2 },
    order: 3,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("target", {
    kind: "story",
    title: "Target",
    partOf: "root",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("sibling", {
    kind: "story",
    title: "Sibling",
    partOf: "root",
    order: 1,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(rootDir, { recursive: true, force: true });
});

describe("applyPendingAppend", () => {
  it("lowers a gated target Story to manual, queues its idle root, and drops the entry", async () => {
    const { applyPendingAppend } = await import("./pending-appends.js");

    await applyPendingAppend("spec", "amend");

    expect(readIssue("target").mergePolicy).toBe("manual");
    expect(readIssue("sibling").mergePolicy).toBeUndefined();
    expect(readIssue("root")).toMatchObject({ workQueuePosition: 1 });
    expect(readIssue("root").mergePolicy).toBeUndefined();
    expect(readIssue("spec")).not.toHaveProperty("pendingAppends");
  });
});

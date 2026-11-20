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
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-release-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(join(issuesDir, ".release-migrated"), "");
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
  writeIssue("cap", {
    kind: "idea",
    title: "Cap",
    partOf: "p",
    archived: true,
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

function seedOutline(settings: Record<string, unknown>): void {
  writeIssue("spec", {
    kind: "outline",
    title: "Spec",
    partOf: "p",
    bodyVersion: 1,
    sourceIdea: "cap",
    order: 2,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    ...settings,
  });
}

function seedEpic(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "epic",
    title: id,
    partOf: "p",
    sourceIdea: "cap",
    sourceOutline: { outline: "spec", version: 1 },
    order: 3,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

async function load() {
  const { releaseWorkRoot } = await import("./release-work-root.js");
  const { list } = await import("./issues.js");
  return { releaseWorkRoot, list };
}

describe("releaseWorkRoot", () => {
  it("marks the plan final and queues the root when the execution gate is off", async () => {
    seedOutline({ executionGate: false, codeApprovalRequired: false });
    seedEpic("root");
    const { releaseWorkRoot, list } = await load();
    expect(list().derived.root?.planNotFinal).toBe(true);

    const releasedAt = await releaseWorkRoot("root");

    expect(readIssue("root")).toMatchObject({
      releasedAt,
      workQueuedAt: releasedAt,
      workQueuePosition: 1,
    });
    expect(readIssue("root").mergePolicy).toBeUndefined();
    expect(list().derived.root?.planNotFinal).toBe(false);
  });
});

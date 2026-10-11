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

function readRaw(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-work-queue-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function loadIssues() {
  return import("./issues.js");
}

function seedProject(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    workspace: "/tmp/repo",
    createdAt: AT,
    updatedAt: AT,
  });
}

describe("work queue enqueue on Idea archive", () => {
  it("stamps the Epic work root when a stakeholder Idea archives", async () => {
    seedProject();
    writeIssue("idea", {
      kind: "idea",
      title: "Idea",
      partOf: "p",
      order: 0,
      archived: false,
      stakeholder: "composer-2.5",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("epic", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("child", {
      kind: "story",
      title: "Child",
      partOf: "epic",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    const { update } = await loadIssues();
    await update("idea", { archived: true });

    expect(typeof readRaw("epic").workQueuedAt).toBe("string");
    expect(readRaw("child").workQueuedAt).toBeUndefined();
  });

  it("does not stamp when executionGate is true", async () => {
    seedProject();
    writeIssue("idea", {
      kind: "idea",
      title: "Idea",
      partOf: "p",
      order: 0,
      archived: false,
      stakeholder: "composer-2.5",
      executionGate: true,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("epic", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });

    const { update } = await loadIssues();
    await update("idea", { archived: true });

    expect(readRaw("epic").workQueuedAt).toBeUndefined();
  });
});

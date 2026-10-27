import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
let root: string;
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function readRaw(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-work-queue-"));
  dir = join(root, "issues");
  mkdirSync(dir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
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
    expect(readRaw("epic").workQueuePosition).toBe(1);
    expect(readRaw("child").workQueuedAt).toBeUndefined();
    expect(readRaw("child").workQueuePosition).toBeUndefined();
  });

  it("does not stamp plan roots when the Idea has appendTo", async () => {
    seedProject();
    writeIssue("target", {
      kind: "story",
      title: "Target",
      partOf: "p",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("idea", {
      kind: "idea",
      title: "Append",
      partOf: "p",
      order: 0,
      archived: false,
      stakeholder: "composer-2.5",
      appendTo: "target",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("task", {
      kind: "task",
      title: "Task",
      partOf: "target",
      order: 0,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });

    const { update } = await loadIssues();
    await update("idea", { archived: true });

    expect(readRaw("target").workQueuedAt).toBeUndefined();
    expect(readRaw("target").workQueuePosition).toBeUndefined();
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
    expect(readRaw("epic").workQueuePosition).toBeUndefined();
  });

  it("queues plan roots in blockedBy order and skips a root whose blocker is not queued or finished", async () => {
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
    writeIssue("outside", {
      kind: "epic",
      title: "Outside",
      partOf: "p",
      order: 1,
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("first", {
      kind: "epic",
      title: "First",
      partOf: "p",
      order: 2,
      sourceIdea: "idea",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("second", {
      kind: "epic",
      title: "Second",
      partOf: "p",
      order: 3,
      sourceIdea: "idea",
      blockedBy: ["first"],
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("held", {
      kind: "epic",
      title: "Held",
      partOf: "p",
      order: 4,
      sourceIdea: "idea",
      blockedBy: ["outside"],
      needsAttention: true,
      attentionReason: "already flagged",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("after-held", {
      kind: "epic",
      title: "After held",
      partOf: "p",
      order: 5,
      sourceIdea: "idea",
      blockedBy: ["held"],
      createdAt: AT,
      updatedAt: AT,
    });

    const { update } = await loadIssues();
    await update("idea", { archived: true });

    expect(readRaw("first").workQueuePosition).toBe(1);
    expect(readRaw("second").workQueuePosition).toBe(2);
    expect(readRaw("first").workQueuedAt).toBe(readRaw("second").workQueuedAt);
    expect(readRaw("held").workQueuedAt).toBeUndefined();
    expect(readRaw("held").workQueuePosition).toBeUndefined();
    expect(readRaw("held").needsAttention).toBe(true);
    expect(readRaw("held").attentionReason).toBe("already flagged");
    expect(readRaw("after-held").workQueuedAt).toBeUndefined();
    expect(readRaw("after-held").needsAttention).not.toBe(true);
    expect(readRaw("after-held").attentionReason ?? null).toBeNull();
  });
});

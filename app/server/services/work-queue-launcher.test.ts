import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLauncherSessions } from "./queue-launcher.test-helpers.js";

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

function readRaw(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(issuesDir, id, "issue.json"), "utf8"));
}

function seedProject(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    workspace: "/tmp/repo",
    maxImplementingRuns: 1,
    createdAt: AT,
    updatedAt: AT,
  });
}

function seedEpic(id: string, order: number, workQueuedAt: string): void {
  writeIssue(id, {
    kind: "epic",
    title: id,
    partOf: "p",
    order,
    workQueuedAt,
    createdAt: AT,
    updatedAt: AT,
  });
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-work-queue-launcher-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(rootDir, { recursive: true, force: true });
});

async function loadLauncher() {
  return import("./work-queue-launcher.js");
}

async function loadConversations() {
  return import("./conversations.js");
}

describe("implementing work-queue launcher", () => {
  it("starts the oldest queued root and holds the next when the cap is 1", async () => {
    seedProject();
    seedEpic("older", 1, "2026-07-01T00:00:00.000Z");
    seedEpic("newer", 2, "2026-07-02T00:00:00.000Z");
    const { sessions, started } = fakeLauncherSessions();
    const { runLauncherPass } = await loadLauncher();
    const { listConversations } = await loadConversations();

    await runLauncherPass(sessions);

    expect(started).toHaveLength(1);
    const metas = listConversations();
    expect(metas).toHaveLength(1);
    expect(metas[0]?.issueId).toBe("older");
    expect(metas[0]?.channel).toBe("implementing");
    expect(metas[0]?.title).toBe("Implement older");
    expect(readRaw("older").workQueuedAt).toBeUndefined();
    expect(readRaw("newer").workQueuedAt).toBe("2026-07-02T00:00:00.000Z");

    await runLauncherPass(sessions);
    expect(started).toHaveLength(1);
  });

});

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

function seedAutonomousProject(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    autonomous: true,
  });
}

function seedIdea(
  id: string,
  order: number,
  extra: Record<string, unknown> = {},
): void {
  writeIssue(id, {
    kind: "idea",
    title: id,
    partOf: "p",
    order,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-plan-queue-"));
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

describe("plan queue launcher", () => {
  it("starts a planning session with the stakeholder model and clears planQueuedAt", async () => {
    seedAutonomousProject();
    seedIdea("older", 1, {
      stakeholder: "composer-2.5",
      planQueuedAt: "2026-07-01T00:00:00.000Z",
    });
    seedIdea("newer", 2, {
      stakeholder: "composer-2.5",
      planQueuedAt: "2026-07-02T00:00:00.000Z",
    });
    const { sessions, started } = fakeLauncherSessions();
    const { runLauncherPass } = await loadLauncher();
    const { listConversations } = await loadConversations();

    await runLauncherPass(sessions);

    expect(started).toHaveLength(2);
    const metas = listConversations();
    expect(metas).toHaveLength(2);
    const byIssue = new Map(metas.map((meta) => [meta.issueId, meta]));
    expect(byIssue.get("older")).toMatchObject({
      channel: "planning",
      model: "composer-2.5",
      title: "Plan older",
    });
    expect(byIssue.get("newer")).toMatchObject({
      channel: "planning",
      model: "composer-2.5",
      title: "Plan newer",
    });
    expect(readRaw("older").planQueuedAt).toBeUndefined();
    expect(readRaw("newer").planQueuedAt).toBeUndefined();
  });
});

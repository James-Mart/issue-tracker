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

function seedEpic(id: string, order: number, workQueuedAt?: string): void {
  writeIssue(id, {
    kind: "epic",
    title: id,
    partOf: "p",
    order,
    ...(workQueuedAt ? { workQueuedAt } : {}),
    createdAt: AT,
    updatedAt: AT,
  });
}

function seedStory(
  id: string,
  partOf: string,
  order: number,
  fields: Record<string, unknown> = {},
): void {
  writeIssue(id, {
    kind: "story",
    title: id,
    partOf,
    order,
    ...fields,
    createdAt: AT,
    updatedAt: AT,
  });
}

function seedTask(id: string, partOf: string, status: string): void {
  writeIssue(id, {
    kind: "task",
    title: id,
    partOf,
    order: 0,
    status,
    createdAt: AT,
    updatedAt: AT,
  });
}

/** An `implementing` session on the root with no run, as a paused loop leaves it. */
async function openIdleSession(rootId: string): Promise<string> {
  const { createConversation } = await loadConversations();
  const meta = await createConversation({
    title: `Implement ${rootId}`,
    projectId: "p",
    model: "composer-2.5",
    issueId: rootId,
    channel: "implementing",
  });
  return meta.id;
}

async function archivedById(): Promise<Map<string, boolean>> {
  const { listConversations } = await loadConversations();
  return new Map(listConversations().map((meta) => [meta.id, meta.archived]));
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

  it("archives finished roots' sessions even when nothing is queued", async () => {
    seedProject();
    seedStory("merged-story", "p", 1, { merged: true });
    seedStory("landing-story", "p", 2);
    seedTask("landing-task", "landing-story", "done");
    seedEpic("landed-epic", 3);
    seedStory("landed-child", "landed-epic", 0, { merged: true });
    seedEpic("open-epic", 4);
    seedStory("open-child", "open-epic", 0);
    seedTask("open-task", "open-child", "todo");
    const finished = [
      await openIdleSession("merged-story"),
      await openIdleSession("landing-story"),
      await openIdleSession("landed-epic"),
    ];
    const open = await openIdleSession("open-epic");
    const { sessions } = fakeLauncherSessions();
    const { runLauncherPass } = await loadLauncher();

    await runLauncherPass(sessions);

    const archived = await archivedById();
    expect(finished.map((id) => archived.get(id))).toEqual([true, true, true]);
    expect(archived.get(open)).toBe(false);
  });
});

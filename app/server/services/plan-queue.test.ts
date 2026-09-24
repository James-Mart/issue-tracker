import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveRun, AgentSessions } from "./agent-sessions.js";

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

function seedProject(autonomous = false): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...(autonomous ? { autonomous: true } : {}),
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

async function loadIssues() {
  return import("./issues.js");
}

async function loadLauncher() {
  return import("./work-queue-launcher.js");
}

async function loadConversations() {
  return import("./conversations.js");
}

function fakeSessions(opts?: { failMessage?: string }): {
  sessions: AgentSessions;
  started: string[];
} {
  const active = new Map<string, ActiveRun>();
  const started: string[] = [];
  const sessions = {
    async sendPrompt(conversationId: string) {
      if (opts?.failMessage) {
        return {
          ok: false as const,
          cause: "scrub_refused" as const,
          message: opts.failMessage,
        };
      }
      const run: ActiveRun = {
        id: `run-${conversationId}`,
        startedAt: AT,
        wait: () => Promise.resolve({} as Awaited<ReturnType<ActiveRun["wait"]>>),
      };
      active.set(conversationId, run);
      started.push(conversationId);
      return { ok: true as const, run };
    },
    getActiveRun(conversationId: string) {
      return active.get(conversationId);
    },
    listActiveRuns() {
      return [...active.keys()].map((conversationId) => ({ conversationId }));
    },
    async cancel() {
      return false;
    },
    async dispose() {},
    async disposeAll() {},
  } satisfies AgentSessions;
  return { sessions, started };
}

describe("plan queue create stamping", () => {
  it("stamps planQueuedAt when creating an Idea with stakeholder in an autonomous Project", async () => {
    seedProject(true);
    const { create } = await loadIssues();
    const idea = await create({
      kind: "idea",
      title: "Auto",
      partOf: "p",
      stakeholder: "composer-2.5",
    });
    expect(idea.kind === "idea" && typeof idea.planQueuedAt).toBe("string");
  });

  it("does not stamp planQueuedAt in a non-autonomous Project", async () => {
    seedProject(false);
    const { create } = await loadIssues();
    const idea = await create({
      kind: "idea",
      title: "Manual",
      partOf: "p",
      stakeholder: "composer-2.5",
    });
    expect(idea.kind === "idea" && idea.planQueuedAt).toBeUndefined();
  });

  it("does not stamp planQueuedAt when stakeholder is set after creation", async () => {
    seedProject(true);
    const { create, update } = await loadIssues();
    const idea = await create({
      kind: "idea",
      title: "Later",
      partOf: "p",
    });
    expect(idea.kind === "idea" && idea.planQueuedAt).toBeUndefined();
    const updated = await update(idea.id, { stakeholder: "composer-2.5" });
    expect(updated.kind === "idea" && updated.planQueuedAt).toBeUndefined();
  });
});

describe("plan queue launcher", () => {
  it("starts a planning session with the stakeholder model and clears planQueuedAt", async () => {
    seedProject(true);
    seedIdea("older", 1, {
      stakeholder: "composer-2.5",
      planQueuedAt: "2026-07-01T00:00:00.000Z",
    });
    seedIdea("newer", 2, {
      stakeholder: "composer-2.5",
      planQueuedAt: "2026-07-02T00:00:00.000Z",
    });
    const { sessions, started } = fakeSessions();
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

  it("posts a launcher comment and clears planQueuedAt when auto-plan fails", async () => {
    seedProject(true);
    seedIdea("boom", 1, {
      stakeholder: "composer-2.5",
      planQueuedAt: "2026-07-01T00:00:00.000Z",
    });
    const { sessions } = fakeSessions({ failMessage: "sdk down" });
    const { runLauncherPass } = await loadLauncher();
    const { readComments } = await loadIssues();

    await runLauncherPass(sessions);

    expect(readRaw("boom").planQueuedAt).toBeUndefined();
    expect(readRaw("boom").archived).toBe(false);
    const comments = readComments("boom");
    expect(comments.messages).toHaveLength(1);
    expect(comments.messages[0]?.role).toBe("launcher");
    expect(comments.messages[0]?.body).toBe(
      "Auto-plan failed to start: sdk down",
    );
  });
});

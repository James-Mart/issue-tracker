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

function seedProject(maxImplementingRuns = 1): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    workspace: "/tmp/repo",
    maxImplementingRuns,
    createdAt: AT,
    updatedAt: AT,
  });
}

function seedEpic(
  id: string,
  order: number,
  workQueuedAt: string | undefined,
  extra: Record<string, unknown> = {},
): void {
  writeIssue(id, {
    kind: "epic",
    title: id,
    partOf: "p",
    order,
    createdAt: AT,
    updatedAt: AT,
    ...(workQueuedAt ? { workQueuedAt } : {}),
    ...extra,
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

function fakeSessions(opts?: {
  failMessage?: string;
  alreadyActive?: Set<string>;
}): { sessions: AgentSessions; started: string[] } {
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

async function loadLauncher() {
  return import("./work-queue-launcher.js");
}

async function loadConversations() {
  return import("./conversations.js");
}

describe("implementing work-queue launcher", () => {
  it("starts the oldest queued root and holds the next when the cap is 1", async () => {
    seedProject(1);
    seedEpic("older", 1, "2026-07-01T00:00:00.000Z");
    seedEpic("newer", 2, "2026-07-02T00:00:00.000Z");
    const { sessions, started } = fakeSessions();
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

  it("skips a blocked root and starts the next eligible one", async () => {
    seedProject(1);
    seedEpic("blocker", 1, undefined);
    seedEpic("blocked", 2, "2026-07-01T00:00:00.000Z", {
      blockedBy: ["blocker"],
    });
    seedEpic("ready", 3, "2026-07-02T00:00:00.000Z");
    const { sessions } = fakeSessions();
    const { runLauncherPass } = await loadLauncher();
    const { listConversations } = await loadConversations();

    await runLauncherPass(sessions);

    expect(listConversations().map((meta) => meta.issueId)).toEqual(["ready"]);
    expect(readRaw("blocked").workQueuedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(readRaw("ready").workQueuedAt).toBeUndefined();
  });

  it("clears workQueuedAt when a human starts the implementing session", async () => {
    seedProject(1);
    seedEpic("older", 1, "2026-07-01T00:00:00.000Z");
    const held = fakeSessions();
    const { runLauncherPass } = await loadLauncher();
    await runLauncherPass(held.sessions);
    expect(held.started).toHaveLength(1);

    seedEpic("manual", 2, "2026-07-03T00:00:00.000Z");
    const { createIssueChannelSession } = await loadConversations();
    const human = fakeSessions();
    await createIssueChannelSession(
      {
        projectId: "p",
        title: "Implement manual",
        model: "composer-2.5",
        issueId: "manual",
        channel: "implementing",
        message: "go",
      },
      human.sessions,
    );

    expect(readRaw("manual").workQueuedAt).toBeUndefined();
    expect(human.started).toHaveLength(0);
  });

  it("sets needsAttention and clears the queue when launch fails", async () => {
    seedProject(1);
    seedEpic("boom", 1, "2026-07-01T00:00:00.000Z");
    const { sessions } = fakeSessions({ failMessage: "sdk down" });
    const { runLauncherPass } = await loadLauncher();

    await runLauncherPass(sessions);

    expect(readRaw("boom").workQueuedAt).toBeUndefined();
    expect(readRaw("boom").needsAttention).toBe(true);
    expect(readRaw("boom").attentionReason).toBe("Auto-start failed: sdk down");
  });

  it("drains a root that was queued while the server was down", async () => {
    seedProject(1);
    seedEpic("waiting", 1, "2026-07-01T00:00:00.000Z");
    const { sessions } = fakeSessions();
    const { runLauncherPass } = await loadLauncher();
    const { listConversations } = await loadConversations();

    await runLauncherPass(sessions);

    expect(listConversations().map((meta) => meta.issueId)).toEqual(["waiting"]);
    expect(readRaw("waiting").workQueuedAt).toBeUndefined();
  });
});

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ActiveRun, AgentSessions } from "./agent-sessions.js";

const AT = "2026-07-09T14:00:00.000Z";

/** Disk seed helpers shared by the work-queue launcher and manual enqueue tests. */
export function workQueueDisk(issuesDir: string) {
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

  function seedProject(fields: Record<string, unknown> = {}): void {
    writeIssue("p", {
      kind: "project",
      title: "P",
      order: 0,
      workspace: "/tmp/repo",
      maxImplementingRuns: 1,
      createdAt: AT,
      updatedAt: AT,
      ...fields,
    });
  }

  function seedEpic(
    id: string,
    order: number,
    fields: Record<string, unknown> = {},
  ): void {
    writeIssue(id, {
      kind: "epic",
      title: id,
      partOf: "p",
      order,
      blockedBy: [],
      ...fields,
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

  return { readRaw, seedProject, seedEpic, seedStory, seedTask };
}

/** Stable wrappers so tests can rebind the temp issues dir in `beforeEach`. */
export function bindWorkQueueDisk() {
  let disk = workQueueDisk("");
  return {
    setDir(issuesDir: string) {
      disk = workQueueDisk(issuesDir);
    },
    readRaw(id: string) {
      return disk.readRaw(id);
    },
    seedProject(fields?: Record<string, unknown>) {
      disk.seedProject(fields);
    },
    seedEpic(id: string, order: number, fields?: Record<string, unknown>) {
      disk.seedEpic(id, order, fields);
    },
    seedStory(
      id: string,
      partOf: string,
      order: number,
      fields?: Record<string, unknown>,
    ) {
      disk.seedStory(id, partOf, order, fields);
    },
    seedTask(id: string, partOf: string, status: string) {
      disk.seedTask(id, partOf, status);
    },
  };
}

/** Sessions that start every prompted conversation and record the order they started in. */
export function fakeLauncherSessions(): {
  sessions: AgentSessions;
  started: string[];
} {
  const active = new Map<string, ActiveRun>();
  const started: string[] = [];
  const sessions = {
    async sendPrompt(conversationId: string) {
      const run: ActiveRun = {
        id: `run-${conversationId}`,
        startedAt: "2026-07-09T14:00:00.000Z",
        steer: async () => "complete_delivered",
        wait: () => Promise.resolve({} as Awaited<ReturnType<ActiveRun["wait"]>>),
      };
      active.set(conversationId, run);
      started.push(conversationId);
      return { ok: true as const, run };
    },
    getActiveRun(conversationId: string) {
      return active.get(conversationId);
    },
    isBusy(conversationId: string) {
      return active.has(conversationId);
    },
    claimStart() {
      return { release() {} };
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

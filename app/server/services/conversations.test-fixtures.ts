import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";

export const AT = "2026-07-09T14:00:00.000Z";

let root: string;
let issuesDir: string;

export function conversationRoot(): string {
  return root;
}

export function conversationIssuesDir(): string {
  return issuesDir;
}

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

/** Temp issues store and the platform/capture/add-auth/root-story seed. */
export function useConversationFixtures(): void {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-conversations-"));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("add-auth", {
      kind: "epic",
      title: "Add auth",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("root-story", {
      kind: "story",
      title: "Root story",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
}

export async function loadService() {
  return import("./conversations.js");
}

export async function loadConfig() {
  return import("../config.js");
}

export function stubSessions() {
  return {
    sendPrompt: vi.fn<AgentSessions["sendPrompt"]>(async () => ({
      ok: true,
      run: {
        id: "run-1",
        startedAt: AT,
        steer: async () => "complete_delivered" as const,
        wait: async () => ({ id: "run-1", status: "finished" }),
      },
    })),
    getActiveRun: () => undefined,
    listActiveRuns: () => [],
    cancel: async () => false,
    dispose: async () => {},
    disposeAll: async () => {},
  } satisfies AgentSessions;
}

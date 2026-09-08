import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";

export const AT = "2026-07-24T12:00:00.000Z";

export let root: string;
export let issuesRoot: string;
export let workspaceDir: string;
export let openSessions: AgentSessions[] = [];

export function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesRoot, id), { recursive: true });
  writeFileSync(join(issuesRoot, id, "issue.json"), JSON.stringify({ id, ...body }));
}

export function runLiveMarkerPath(conversationId: string): string {
  return join(
    dirname(issuesRoot),
    "conversations",
    conversationId,
    "run-live.json",
  );
}

export async function load() {
  const conversations = await import("./conversations.js");
  const { createAgentSessions: create, isRunLive } = await import(
    "./agent-sessions.js"
  );
  const { subscribeFrames } = await import("./conversation-stream.js");
  const {
    conversationDelegationOutstandingForTests,
    MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION,
    resetDelegationConcurrencyForTests,
  } = await import("./delegate-tool.js");
  const createAgentSessions: typeof create = (...args) => {
    const sessions = create(...args);
    openSessions.push(sessions);
    return sessions;
  };
  return {
    ...conversations,
    createAgentSessions,
    isRunLive,
    subscribeFrames,
    conversationDelegationOutstandingForTests,
    MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION,
    resetDelegationConcurrencyForTests,
  };
}

export function useAgentSessionsTestFixtures(): void {
  beforeEach(() => {
    // Nest issues/ under a unique root so conversations/ (peer of issues/) is
    // also unique. A mkdtemp used directly as ISSUES_DIR would put every worker
    // on shared tmpdir()/conversations and flake under parallel npm test.
    root = mkdtempSync(join(tmpdir(), "issue-tracker-sessions-"));
    issuesRoot = join(root, "issues");
    mkdirSync(issuesRoot, { recursive: true });
    workspaceDir = mkdtempSync(join(tmpdir(), "issue-session-ws-"));
    mkdirSync(join(workspaceDir, ".git"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesRoot);
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      workspace: workspaceDir,
      createdAt: AT,
      updatedAt: AT,
    });
  });

  afterEach(async () => {
    await Promise.all(openSessions.map((s) => s.disposeAll()));
    openSessions = [];
    const { resetDelegationConcurrencyForTests } = await import(
      "./delegate-tool.js"
    );
    resetDelegationConcurrencyForTests();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });
}

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CursorAgentError } from "./agent-sdk.js";
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

function readIssue(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(issuesDir, id, "issue.json"), "utf8"));
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "issue-tracker-idea-conclude-"));
  issuesDir = join(rootDir, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: "/tmp/repo",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(rootDir, { recursive: true, force: true });
});

function seedIdea(id: string, extra: Record<string, unknown> = {}): void {
  writeIssue(id, {
    kind: "idea",
    title: id,
    partOf: "p",
    archived: false,
    order: 1,
    createdAt: AT,
    updatedAt: AT,
    ...extra,
  });
}

function seedOutline(id: string, sourceIdea: string): void {
  writeIssue(id, {
    kind: "outline",
    title: "Feature outline",
    partOf: "p",
    bodyVersion: 2,
    sourceIdea,
    order: 0,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
}

describe("concludeIdea", () => {
  it("copies plan settings, archives the idea, and does not enqueue or lower a plan root", async () => {
    seedIdea("cap", {
      stakeholder: "cursor-grok-4.7",
      executionGate: "auto",
      decompositionGate: true,
      outOfBand: false,
      mergeBase: "feature",
      mergePolicy: "pull-request",
    });
    seedOutline("spec", "cap");
    writeIssue("root", {
      kind: "epic",
      title: "Root",
      partOf: "p",
      sourceIdea: "cap",
      blockedBy: [],
      needsAttention: false,
      archived: false,
      mergePolicy: "merge",
      order: 2,
      createdAt: AT,
      updatedAt: AT,
    });
    const { sessions } = fakeLauncherSessions();
    const { concludeIdea } = await import("./idea-conclude.js");
    const { list } = await import("./issues.js");
    const { listConversations } = await import("./conversations.js");

    const result = await concludeIdea("cap", "spec", "gated", sessions);

    expect(result.sessionId).toBeUndefined();
    expect(result.concludedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readIssue("cap")).toMatchObject({
      archived: true,
      codeApprovalRequired: true,
      decompositionGate: true,
    });
    expect(readIssue("spec")).toMatchObject({
      executionGate: "auto",
      codeApprovalRequired: true,
      mergeBase: "feature",
      mergePolicy: "pull-request",
      outOfBand: false,
      concludedAt: result.concludedAt,
      sourceIdea: "cap",
    });
    expect(readIssue("root")).toMatchObject({
      mergePolicy: "merge",
    });
    expect(readIssue("root").workQueuedAt).toBeUndefined();
    expect(list().derived.spec?.readyToDecompose).toBe(true);
    expect(listConversations()).toEqual([]);
  });

  it("leaves the write committed when the decomposer does not start", async () => {
    seedIdea("cap", { executionGate: false });
    seedOutline("spec", "cap");
    const { sessions } = fakeLauncherSessions();
    sessions.sendPrompt = async () => ({
      ok: false,
      cause: "never_started",
      error: new CursorAgentError("agent down"),
    });
    const { concludeIdea } = await import("./idea-conclude.js");
    const { IssueError } = await import("./errors.js");
    const { list } = await import("./issues.js");

    const caught = await concludeIdea("cap", "spec", "start", sessions).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(IssueError);
    expect((caught as Error).message).toMatch(
      /concluded onto outline "spec", but the decomposer did not start: agent down/,
    );
    expect(readIssue("cap").archived).toBe(true);
    expect(readIssue("spec").concludedAt).toEqual(expect.any(String));
    expect(list().derived.spec?.readyToDecompose).toBe(true);
  });
});

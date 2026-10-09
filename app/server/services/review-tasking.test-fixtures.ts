import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";

export const AT = "2026-07-09T14:00:00.000Z";
export const REVIEW_ID = "11111111-1111-4111-8111-111111111111";

let root: string;
let issuesDir: string;

export function writeReviewTaskingIssue(
  id: string,
  body: Record<string, unknown>,
): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

export function seedReviewTasking(): void {
  writeReviewTaskingIssue("p", {
    kind: "project",
    title: "P",
    workspace: root,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeReviewTaskingIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeReviewTaskingIssue("s", {
    kind: "story",
    title: "S",
    partOf: "e",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  mkdirSync(join(issuesDir, "p", "reviews"), { recursive: true });
  writeFileSync(
    join(issuesDir, "p", "reviews", `${REVIEW_ID}.json`),
    `${JSON.stringify({
      id: REVIEW_ID,
      projectId: "p",
      target: { kind: "story", storyId: "s" },
      status: "open",
      postMortem: false,
      createdAt: AT,
      updatedAt: AT,
      marks: { all: {}, commits: {} },
    })}\n`,
  );
}

export function writeReviewSubmissions(submissions: unknown[]): void {
  const path = join(issuesDir, "p", "reviews", `${REVIEW_ID}.json`);
  const current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...current, submissions })}\n`);
}

/** Temp issues store with ISSUES_DIR and module reset for review-tasking tests. */
export function useReviewTaskingStore(tempPrefix: string): void {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), tempPrefix));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
}

/** Records each prompt sent and reports every launch as started. */
export function stubReviewTaskingSessions(prompts: string[]): AgentSessions {
  return {
    getActiveRun: () => undefined,
    sendPrompt: async (_id: string, options: { prompt: string }) => {
      prompts.push(options.prompt);
      return { ok: true as const, run: { id: "run-1" } as never };
    },
  } as unknown as AgentSessions;
}

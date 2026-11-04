import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, vi } from "vitest";
import type { ReviewSubmission } from "../schemas/review.js";
import type { AgentSessions } from "./agent-sessions.js";

export const AT = "2026-07-09T14:00:00.000Z";
export const REVIEW_ID = "11111111-1111-4111-8111-111111111111";

export function onlySubmission(view: { submissions: ReviewSubmission[] }): ReviewSubmission {
  return view.submissions[0]!;
}

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
  writeReviewTaskingIssue(REVIEW_ID, {
    kind: "review",
    title: "S",
    partOf: "p",
    story: "s",
    archived: false,
    marks: { all: {}, commits: {} },
    submissions: [],
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

export const OUTLINE_ID = "spec";

/** Outline `spec` at version 1, with Story `s` linked to it. */
export function seedOutlinedStory(): void {
  writeReviewTaskingIssue(OUTLINE_ID, {
    kind: "outline",
    title: "Spec",
    partOf: "p",
    bodyVersion: 1,
    order: 1,
    archived: false,
    createdAt: AT,
    updatedAt: AT,
  });
  writeFileSync(join(issuesDir, OUTLINE_ID, "description.md"), "saved\n");
  mkdirSync(join(issuesDir, OUTLINE_ID, "versions"), { recursive: true });
  writeFileSync(join(issuesDir, OUTLINE_ID, "versions", "1.md"), "saved\n");
  const storyPath = join(issuesDir, "s", "issue.json");
  const story = JSON.parse(readFileSync(storyPath, "utf8")) as Record<string, unknown>;
  writeFileSync(
    storyPath,
    JSON.stringify({ ...story, sourceOutline: { outline: OUTLINE_ID, version: 1 } }),
  );
}

export function writeReviewSubmissions(submissions: unknown[]): void {
  const path = join(issuesDir, REVIEW_ID, "issue.json");
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
    isBusy: () => false,
    claimStart: () => ({ release() {} }),
    sendPrompt: async (_id: string, options: { prompt: string }) => {
      prompts.push(options.prompt);
      return { ok: true as const, run: { id: "run-1" } as never };
    },
  } as unknown as AgentSessions;
}

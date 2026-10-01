import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";

const AT = "2026-07-09T14:00:00.000Z";
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";

let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(join(issuesDir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function seed(story: Record<string, unknown> = {}): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: root,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("e", {
    kind: "epic",
    title: "E",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: "e",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...story,
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

function writeSubmissions(submissions: unknown[]): void {
  const path = join(issuesDir, "p", "reviews", `${REVIEW_ID}.json`);
  const current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...current, submissions })}\n`);
}

function stubSessions(): AgentSessions {
  return { getActiveRun: () => undefined } as unknown as AgentSessions;
}

async function load() {
  const tasking = await import("./review-tasking.js");
  const threads = await import("./thread-events.js");
  const issues = await import("./issues.js");
  return { ...tasking, ...threads, ...issues };
}

describe("retryOpenReviewSubmissions", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-retry-open-"));
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

  it("returns every incomplete and failed submission to tasking", async () => {
    seed();
    writeSubmissions([
      {
        id: "sub-open",
        at: "2026-07-09T15:00:00.000Z",
        status: "incomplete",
        threadIds: ["thread-open"],
      },
      {
        id: "sub-failed",
        at: "2026-07-09T16:00:00.000Z",
        status: "failed",
        threadIds: ["thread-failed"],
        error: "tasker exploded",
      },
    ]);
    const { retryOpenReviewSubmissions } = await load();
    const view = await retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions());
    expect(view.submissions.map((item) => ({ id: item.id, status: item.status }))).toEqual([
      { id: "sub-open", status: "tasking" },
      { id: "sub-failed", status: "tasking" },
    ]);
    expect(view.submissions[1]).not.toHaveProperty("error");
  });

  it("finishes a submission whose threads are already handled and retries the rest", async () => {
    seed();
    const { retryOpenReviewSubmissions, appendComment, appendThreadEvent } = await load();
    const handled = await appendComment("s", { role: "human", body: "Handled" });
    const open = await appendComment("s", { role: "human", body: "Still open" });
    await appendThreadEvent("s", handled.id, { event: "resolved", by: { role: "human" } });
    writeSubmissions([
      {
        id: "sub-handled",
        at: "2026-07-09T15:00:00.000Z",
        status: "incomplete",
        threadIds: [handled.id],
      },
      {
        id: "sub-open",
        at: "2026-07-09T16:00:00.000Z",
        status: "failed",
        threadIds: [open.id],
        error: "tasker exploded",
      },
    ]);
    const view = await retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions());
    expect(view.submissions.map((item) => ({ id: item.id, status: item.status }))).toEqual([
      { id: "sub-handled", status: "done" },
      { id: "sub-open", status: "tasking" },
    ]);
  });

  it("refuses when a submission is already tasking or none can be retried", async () => {
    seed();
    const { retryOpenReviewSubmissions, NO_RETRYABLE_SUBMISSION_ERROR, SUBMISSION_TASKING_ERROR } =
      await load();
    writeSubmissions([
      {
        id: "sub-done",
        at: "2026-07-09T15:00:00.000Z",
        status: "done",
        threadIds: ["thread-done"],
        taskIds: ["task-done"],
      },
    ]);
    await expect(
      retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions()),
    ).rejects.toThrow(NO_RETRYABLE_SUBMISSION_ERROR);

    writeSubmissions([
      {
        id: "sub-run",
        at: "2026-07-09T15:00:00.000Z",
        status: "tasking",
        threadIds: ["thread-run"],
      },
      {
        id: "sub-open",
        at: "2026-07-09T16:00:00.000Z",
        status: "incomplete",
        threadIds: ["thread-open"],
      },
    ]);
    await expect(
      retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions()),
    ).rejects.toThrow(SUBMISSION_TASKING_ERROR);
  });

  it("refuses on a merged Story", async () => {
    seed({ merged: true });
    writeSubmissions([
      {
        id: "sub-open",
        at: "2026-07-09T15:00:00.000Z",
        status: "incomplete",
        threadIds: ["thread-open"],
      },
    ]);
    const { retryOpenReviewSubmissions, mergedStoryTaskingError } = await load();
    await expect(
      retryOpenReviewSubmissions("p", REVIEW_ID, {}, stubSessions()),
    ).rejects.toThrow(mergedStoryTaskingError("s"));
  });
});

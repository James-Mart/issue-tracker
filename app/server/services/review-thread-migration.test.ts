import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-07-09T14:00:00.000Z";
const COMMIT_SHA = "deadbeef00000000000000000000000000000000";
const ANCHOR = { path: "a.ts", side: "new", line: 2, commitSha: COMMIT_SHA };

let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, createdAt: AT, updatedAt: AT, ...body }),
  );
}

function writeStory(id: string, body: Record<string, unknown> = {}): void {
  writeIssue(id, { kind: "story", title: `Story ${id}`, partOf: "p", order: 0, ...body });
}

function writeLog(id: string, records: Record<string, unknown>[]): void {
  writeFileSync(
    join(issuesDir, id, "comments.jsonl"),
    records.map((record) => `${JSON.stringify(record)}\n`).join(""),
  );
}

function logRecords(id: string): Record<string, unknown>[] {
  const path = join(issuesDir, id, "comments.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function ids(id: string): unknown[] {
  return logRecords(id).map((record) => record.id ?? record.type);
}

function writeConversation(id: string, issueId: string, channel: string): void {
  const dir = join(root, "conversations", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      id,
      title: id,
      projectId: "p",
      issueId,
      channel,
      model: "m",
      createdAt: AT,
      updatedAt: AT,
    }),
  );
}

function conversationIssueId(id: string): unknown {
  const meta = JSON.parse(
    readFileSync(join(root, "conversations", id, "meta.json"), "utf8"),
  ) as { issueId?: unknown };
  return meta.issueId;
}

function comment(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, at: AT, role: "human", body: id, ...extra };
}

async function migrate(): Promise<void> {
  const { ensureReviewThreadsMigrated } = await import("./review-thread-migration.js");
  ensureReviewThreadsMigrated();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-review-thread-migration-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeIssue("p", { kind: "project", title: "P" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("ensureReviewThreadsMigrated", () => {
  it("moves review threads to the existing review and leaves other Story comments", async () => {
    writeStory("s");
    writeIssue("r", {
      kind: "review",
      title: "Story s",
      partOf: "p",
      story: "s",
      archived: false,
      marks: { all: {}, commits: {} },
      submissions: [
        {
          id: "sub",
          at: AT,
          status: "done",
          threadIds: ["submitted"],
          summaryCommentId: "summary",
          taskIds: [],
        },
      ],
      order: 1,
    });
    writeLog("s", [
      comment("note"),
      comment("anchored", { anchor: ANCHOR }),
      comment("anchored-reply", { replyTo: "anchored" }),
      { type: "comment-edit", commentId: "anchored-reply", body: "edited", at: AT, role: "human" },
      comment("question", { kind: "question" }),
      comment("answer", { replyTo: "question", role: "agent", name: "Researcher" }),
      comment("submitted"),
      comment("summary"),
      comment("resolved-note"),
      { type: "thread-event", threadId: "resolved-note", event: "resolved", at: AT, by: { role: "human" } },
      comment("handoff", { type: "human-request" }),
      comment("handoff-reply", { replyTo: "handoff", type: "human-response" }),
      comment("mirrored", { anchor: ANCHOR, source: { provider: "github", id: 1 } }),
      comment("note-reply", { replyTo: "note" }),
    ]);
    writeConversation("tasker", "s", "review");
    writeConversation("planner", "s", "planning");

    await migrate();

    expect(ids("s")).toEqual(["note", "handoff", "handoff-reply", "mirrored", "note-reply"]);
    expect(ids("r")).toEqual([
      "anchored",
      "anchored-reply",
      "comment-edit",
      "question",
      "answer",
      "submitted",
      "summary",
      "resolved-note",
      "thread-event",
    ]);
    expect(conversationIssueId("tasker")).toBe("r");
    expect(conversationIssueId("planner")).toBe("s");
    expect(existsSync(join(issuesDir, ".review-threads-migrated"))).toBe(true);
  });
});

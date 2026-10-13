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
const SOURCE = {
  kind: "github",
  id: "IC_1",
  url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
};

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

function comment(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, at: AT, role: "human", body: id, ...extra };
}

async function migrate(): Promise<void> {
  const { ensureGithubCommentsMigrated } = await import("./github-comment-migration.js");
  ensureGithubCommentsMigrated();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "issue-tracker-github-comment-migration-"));
  issuesDir = join(root, "issues");
  mkdirSync(issuesDir, { recursive: true });
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", issuesDir);
  writeIssue("p", { kind: "project", title: "P", order: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("ensureGithubCommentsMigrated", () => {
  it("moves mirrored threads onto the existing review and leaves other Story comments", async () => {
    writeStory("s");
    writeIssue("r", {
      kind: "review",
      title: "Story s",
      partOf: "p",
      story: "s",
      archived: false,
      marks: { all: {}, commits: {} },
      submissions: [],
      order: 1,
    });
    writeLog("s", [
      comment("note"),
      comment("mirrored", { source: SOURCE }),
      comment("local-reply", { replyTo: "mirrored" }),
      { type: "comment-edit", commentId: "mirrored", body: "edited", at: AT, role: "human" },
      comment("github-reply", {
        replyTo: "mirrored",
        source: { ...SOURCE, id: "IC_2" },
      }),
      { type: "thread-event", threadId: "mirrored", event: "resolved", at: AT, by: { role: "human" } },
      comment("handoff", { type: "human-request" }),
    ]);
    writeLog("r", [comment("kept")]);

    await migrate();

    expect(ids("s")).toEqual(["note", "handoff"]);
    expect(ids("r")).toEqual([
      "kept",
      "mirrored",
      "local-reply",
      "comment-edit",
      "github-reply",
      "thread-event",
    ]);
    expect(existsSync(join(issuesDir, ".github-comments-migrated"))).toBe(true);
  });
});

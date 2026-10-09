import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentAnchor } from "../schemas.js";

const AT = "2026-07-09T14:00:00.000Z";
const COMMIT_SHA = "deadbeef00000000000000000000000000000000";
const LINE_ANCHOR: CommentAnchor = {
  path: "src/review.ts",
  side: "new",
  line: 4,
  commitSha: COMMIT_SHA,
};

let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

function seedStory(): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
}

async function load() {
  const issues = await import("./issues.js");
  const edit = await import("./comment-edit.js");
  const threads = await import("./thread-events.js");
  const reads = await import("./researcher-runs.js");
  return { ...issues, ...edit, ...threads, enrichCommentsForRead: reads.enrichCommentsForRead };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-comment-edit-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  seedStory();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("editComment", () => {
  it("appends a comment-edit and folds the latest body into the view", async () => {
    const { appendComment, editComment, readComments, enrichCommentsForRead } =
      await load();
    const root = await appendComment("s", {
      role: "human",
      name: "Ada",
      body: "first",
      anchor: LINE_ANCHOR,
    });
    const reply = await appendComment("s", {
      role: "human",
      body: "also",
      replyTo: root.id,
    });

    const edited = await editComment(
      "s",
      root.id,
      { body: "second" },
      { role: "human", name: "Ada" },
    );
    expect(edited.body).toBe("second");
    expect(edited.editable).toBe(true);
    expect(edited.id).toBe(root.id);

    await editComment("s", root.id, { body: "third" }, { role: "agent" });

    const lines = readFileSync(join(dir, "s", "comments.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type?: string; body: string; commentId?: string; role?: string; name?: string });
    expect(lines[0]?.body).toBe("first");
    expect(lines[0]?.type).toBeUndefined();
    expect(lines[2]).toMatchObject({
      type: "comment-edit",
      commentId: root.id,
      body: "second",
      role: "human",
      name: "Ada",
    });
    expect(lines[3]).toMatchObject({
      type: "comment-edit",
      commentId: root.id,
      body: "third",
      role: "agent",
    });
    expect(lines[3]?.name).toBeUndefined();

    const comments = readComments("s");
    expect(comments.messages.map((message) => message.body)).toEqual([
      "third",
      "also",
    ]);
    expect(comments.problems).toEqual([]);

    const view = await enrichCommentsForRead("s");
    expect(view.messages.find((message) => message.id === root.id)?.editable).toBe(
      true,
    );
    expect(view.messages.find((message) => message.id === reply.id)?.editable).toBe(
      true,
    );
  });
});

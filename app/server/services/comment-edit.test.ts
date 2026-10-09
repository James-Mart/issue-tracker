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
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ANCHOR: CommentAnchor = {
  path: "src/review.ts",
  side: "new",
  line: 4,
  commitSha: COMMIT_SHA,
};
const FILE_ANCHOR: CommentAnchor = {
  path: "src/review.ts",
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

  it("treats a file anchor like a line anchor", async () => {
    const { appendComment, editComment } = await load();
    const root = await appendComment("s", {
      role: "human",
      body: "file",
      anchor: FILE_ANCHOR,
    });
    const edited = await editComment("s", root.id, { body: "file 2" }, { role: "human" });
    expect(edited.body).toBe("file 2");
  });

  it("edits a converted question and refuses the researcher reply", async () => {
    const { appendComment, appendThreadEvent, editComment, enrichCommentsForRead } =
      await load();
    const root = await appendComment("s", {
      role: "human",
      body: "why?",
      kind: "question",
      anchor: LINE_ANCHOR,
    });
    const answer = await appendComment("s", {
      role: "agent",
      name: "Researcher",
      body: "because",
      replyTo: root.id,
    });
    await expect(
      editComment("s", root.id, { body: "why though" }, { role: "human" }),
    ).rejects.toThrow(/question/);
    await appendThreadEvent("s", root.id, {
      event: "converted",
      by: { role: "human", name: "Ada" },
    });
    const edited = await editComment(
      "s",
      root.id,
      { body: "why though" },
      { role: "human" },
    );
    expect(edited.body).toBe("why though");
    await expect(
      editComment("s", answer.id, { body: "nope" }, { role: "human" }),
    ).rejects.toThrow(/researcher reply/);
    const view = await enrichCommentsForRead("s");
    expect(view.messages.find((message) => message.id === root.id)?.editable).toBe(
      true,
    );
    expect(view.messages.find((message) => message.id === answer.id)?.editable).toBe(
      false,
    );
  });

  it("refuses GitHub-sourced comments and marks them not editable on read", async () => {
    const { appendComment, editComment, enrichCommentsForRead } = await load();
    const source = {
      kind: "github" as const,
      id: "IC_1",
      url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
    };
    const root = await appendComment("s", {
      role: "human",
      name: "ada",
      body: "from github",
      anchor: LINE_ANCHOR,
      source,
    });
    const reply = await appendComment("s", {
      role: "human",
      body: "tracker reply",
      replyTo: root.id,
    });
    await expect(
      editComment("s", root.id, { body: "changed" }, { role: "human" }),
    ).rejects.toThrow(/github/);
    const editedReply = await editComment(
      "s",
      reply.id,
      { body: "edited reply" },
      { role: "human" },
    );
    expect(editedReply.body).toBe("edited reply");
    const view = await enrichCommentsForRead("s");
    expect(view.messages.find((message) => message.id === root.id)?.editable).toBe(
      false,
    );
    expect(view.messages.find((message) => message.id === reply.id)?.editable).toBe(
      true,
    );
  });

  it("refuses story notes, linked threads, submissions, and resolved threads", async () => {
    const { appendComment, appendThreadEvent, editComment } = await load();
    const note = await appendComment("s", { role: "human", body: "note" });
    await expect(
      editComment("s", note.id, { body: "changed" }, { role: "human" }),
    ).rejects.toThrow(/Story note/);

    const root = await appendComment("s", {
      role: "human",
      body: "pending",
      anchor: LINE_ANCHOR,
    });
    writeIssue("t", {
      kind: "task",
      title: "T",
      partOf: "s",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    await appendThreadEvent("s", root.id, {
      event: "linked",
      taskId: "t",
      by: { role: "human" },
    });
    await expect(
      editComment("s", root.id, { body: "changed" }, { role: "human" }),
    ).rejects.toThrow(/linked/);

    const open = await appendComment("s", {
      role: "human",
      body: "open",
      anchor: LINE_ANCHOR,
    });
    mkdirSync(join(dir, "p", "reviews"), { recursive: true });
    writeFileSync(
      join(dir, "p", "reviews", `${REVIEW_ID}.json`),
      JSON.stringify({
        id: REVIEW_ID,
        projectId: "p",
        target: { kind: "story", storyId: "s" },
        status: "open",
        postMortem: false,
        createdAt: AT,
        updatedAt: AT,
        marks: { all: {}, commits: {} },
        submissions: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            at: AT,
            threadIds: [open.id],
            status: "failed",
            error: "tasker stopped",
          },
        ],
      }),
    );
    await expect(
      editComment("s", open.id, { body: "changed" }, { role: "human" }),
    ).rejects.toThrow(/submitted/);

    const resolved = await appendComment("s", {
      role: "human",
      body: "done",
      anchor: LINE_ANCHOR,
    });
    await appendThreadEvent("s", resolved.id, {
      event: "resolved",
      by: { role: "human" },
    });
    await expect(
      editComment("s", resolved.id, { body: "changed" }, { role: "human" }),
    ).rejects.toThrow(/resolved/);
  });

  it("refuses an anchored comment that is not on a Story", async () => {
    writeIssue("t", {
      kind: "task",
      title: "T",
      partOf: "s",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const { appendComment, editComment, enrichCommentsForRead } = await load();
    const message = await appendComment("t", {
      role: "agent",
      body: "task note",
      anchor: LINE_ANCHOR,
    });
    await expect(
      editComment("t", message.id, { body: "changed" }, { role: "human" }),
    ).rejects.toThrow(/Story note/);
    const view = await enrichCommentsForRead("t");
    expect(view.messages[0]?.editable).toBe(false);
  });

  it("rejects an unknown comment and an empty body", async () => {
    const { editComment } = await load();
    await expect(
      editComment("s", "missing", { body: "x" }, { role: "human" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      editComment("s", "missing", { body: "" }, { role: "human" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("skips a malformed edit and an edit of an unknown id into problems", async () => {
    const { appendComment, readComments } = await load();
    const root = await appendComment("s", {
      role: "human",
      body: "kept",
      anchor: LINE_ANCHOR,
    });
    writeFileSync(
      join(dir, "s", "comments.jsonl"),
      [
        JSON.stringify({
          id: root.id,
          role: "human",
          body: "kept",
          at: AT,
          anchor: LINE_ANCHOR,
        }),
        JSON.stringify({ type: "comment-edit", commentId: root.id }),
        JSON.stringify({
          type: "comment-edit",
          commentId: "gone",
          body: "nope",
          at: AT,
          role: "human",
        }),
        JSON.stringify({
          type: "comment-edit",
          commentId: root.id,
          body: "folded",
          at: AT,
          role: "human",
        }),
        "",
      ].join("\n"),
    );
    const comments = readComments("s");
    expect(comments.messages[0]?.body).toBe("folded");
    expect(comments.problems.map((problem) => problem.message).join("\n")).toMatch(
      /comments\.jsonl line 2: body:/,
    );
    expect(comments.problems.map((problem) => problem.message).join("\n")).toMatch(
      /unknown comment "gone"/,
    );
  });
});

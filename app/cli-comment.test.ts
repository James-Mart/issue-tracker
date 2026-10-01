import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  dir,
  env,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

const COMMIT_SHA = "deadbeef00000000000000000000000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/;

useCliTestFixtures();

describe("comment anchor and reply flags", () => {
  beforeEach(() => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("t", {
      kind: "task",
      title: "Task",
      partOf: "p",
      order: 0,
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("appends an anchored comment and prints its id", async () => {
    const { stdout, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "on this line",
        "--path",
        "app/cli-ops.ts",
        "--side",
        "new",
        "--line",
        "42",
        "--start-line",
        "40",
        "--commit",
        COMMIT_SHA,
      ],
      { env: env() },
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(UUID_RE);

    const stored = JSON.parse(
      readFileSync(join(dir, "t", "comments.jsonl"), "utf8").trim(),
    );
    expect(stored.id).toBe(stdout.trim());
    expect(stored.anchor).toEqual({
      path: "app/cli-ops.ts",
      side: "new",
      line: 42,
      startLine: 40,
      commitSha: COMMIT_SHA,
    });
  });

  it("appends a file anchor with path and commit and no line or side", async () => {
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const created = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "human",
        "--body",
        "on this file",
        "--path",
        "app/cli-ops.ts",
        "--commit",
        COMMIT_SHA,
      ],
      { env: env() },
    );
    expect(created.status).toBe(0);
    const stored = JSON.parse(
      readFileSync(join(dir, "s", "comments.jsonl"), "utf8").trim(),
    ) as { anchor: Record<string, unknown> };
    expect(stored.anchor).toEqual({
      path: "app/cli-ops.ts",
      commitSha: COMMIT_SHA,
    });

    const question = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "human",
        "--body",
        "Why this file?",
        "--kind",
        "question",
        "--path",
        "app/cli-ops.ts",
        "--commit",
        COMMIT_SHA,
      ],
      { env: env() },
    );
    expect(question.status).toBe(0);
    const lines = readFileSync(join(dir, "s", "comments.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[1]).toMatchObject({
      kind: "question",
      anchor: { path: "app/cli-ops.ts", commitSha: COMMIT_SHA },
    });

    const viewed = await runIssueCli(["view", "s", "--comments"], { env: env() });
    expect(viewed.status).toBe(0);
    expect(viewed.stdout).toContain(
      `@ app/cli-ops.ts ${COMMIT_SHA.slice(0, 7)} (outdated): on this file`,
    );
  });

  it("refuses a file anchor that also passes --start-line", async () => {
    const { stderr, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "mixed",
        "--path",
        "app/cli-ops.ts",
        "--commit",
        COMMIT_SHA,
        "--start-line",
        "4",
      ],
      { env: env() },
    );
    expect(status).toBe(1);
    expect(stderr).toContain(
      "a line anchor requires --path, --side, --line, and --commit",
    );
  });

  it("refuses a file anchor missing --commit", async () => {
    const { stderr, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "path only",
        "--path",
        "app/cli-ops.ts",
      ],
      { env: env() },
    );
    expect(status).toBe(1);
    expect(stderr).toContain("a file anchor requires --path and --commit");
  });

  it("appends a reply and prints its id", async () => {
    writeFileSync(
      join(dir, "t", "comments.jsonl"),
      `${JSON.stringify({
        id: "root-id",
        role: "agent",
        body: "root",
        at: nextAt(),
      })}\n`,
    );

    const { stdout, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "human",
        "--body",
        "reply text",
        "--reply-to",
        "root-id",
      ],
      { env: env() },
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(UUID_RE);

    const lines = readFileSync(join(dir, "t", "comments.jsonl"), "utf8")
      .trim()
      .split("\n");
    const reply = JSON.parse(lines[1]!);
    expect(reply.id).toBe(stdout.trim());
    expect(reply.replyTo).toBe("root-id");
  });

  it("refuses a partial anchor missing --commit", async () => {
    const { stderr, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "incomplete",
        "--path",
        "app/cli-ops.ts",
        "--side",
        "new",
        "--line",
        "1",
      ],
      { env: env() },
    );
    expect(status).toBe(1);
    expect(stderr).toContain(
      "a line anchor requires --path, --side, --line, and --commit",
    );
  });

  it("refuses --reply-to combined with --path", async () => {
    const { stderr, status } = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "conflict",
        "--reply-to",
        "root-id",
        "--path",
        "app/cli-ops.ts",
        "--side",
        "new",
        "--line",
        "1",
        "--commit",
        COMMIT_SHA,
      ],
      { env: env() },
    );
    expect(status).toBe(1);
    expect(stderr).toContain("--reply-to cannot be combined with anchor flags");
  });

  it("replies and resolves a Story thread with --resolve", async () => {
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(
      join(dir, "s", "comments.jsonl"),
      `${JSON.stringify({
        id: "root-id",
        role: "story-review",
        body: "fix the guard",
        at: nextAt(),
      })}\n`,
    );

    const { stdout, status } = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "implementor",
        "--name",
        "Ada",
        "--body",
        "added the guard in diff-fetch.ts",
        "--reply-to",
        "root-id",
        "--resolve",
      ],
      { env: env() },
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(UUID_RE);

    const lines = readFileSync(join(dir, "s", "comments.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatchObject({
      id: stdout.trim(),
      role: "implementor",
      name: "Ada",
      body: "added the guard in diff-fetch.ts",
      replyTo: "root-id",
    });
    expect(lines[2]).toMatchObject({
      type: "thread-event",
      threadId: "root-id",
      event: "resolved",
      by: { role: "implementor", name: "Ada" },
    });
  });

  it("refuses --resolve without --reply-to and on a non-Story", async () => {
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(
      join(dir, "s", "comments.jsonl"),
      `${JSON.stringify({
        id: "root-id",
        role: "human",
        body: "root",
        at: nextAt(),
      })}\n`,
    );

    const missingReply = await runIssueCli(
      ["comment", "s", "--role", "implementor", "--body", "fix", "--resolve"],
      { env: env() },
    );
    expect(missingReply.status).toBe(1);
    expect(missingReply.stderr).toContain("--resolve requires --reply-to and --body");

    const task = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "implementor",
        "--body",
        "fix",
        "--reply-to",
        "root-id",
        "--resolve",
      ],
      { env: env() },
    );
    expect(task.status).toBe(1);
    expect(task.stderr).toContain('issue "t" is not a Story');
    expect(readFileSync(join(dir, "s", "comments.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("starts a question thread with --kind question and refuses it on a reply", async () => {
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const created = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "human",
        "--body",
        "Does the guard run locally?",
        "--kind",
        "question",
      ],
      { env: env() },
    );
    expect(created.status).toBe(0);
    const lines = readFileSync(join(dir, "s", "comments.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      role: "human",
      body: "Does the guard run locally?",
      kind: "question",
    });
    expect(lines[0]?.replyTo).toBeUndefined();

    const reply = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "human",
        "--body",
        "follow up",
        "--reply-to",
        String(lines[0]?.id),
        "--kind",
        "question",
      ],
      { env: env() },
    );
    expect(reply.status).toBe(1);
    expect(reply.stderr).toContain("--kind question applies only to a new thread root");

    const task = await runIssueCli(
      [
        "comment",
        "t",
        "--role",
        "human",
        "--body",
        "not a story",
        "--kind",
        "question",
      ],
      { env: env() },
    );
    expect(task.status).toBe(1);
    expect(task.stderr).toContain("comment kind is only valid on a Story");
  });

  it("documents --resolve on comment --help", async () => {
    const help = await runIssueCli(["comment", "--help"], { env: env() });
    expect(help.status).toBe(0);
    expect(help.stdout.replace(/\s+/g, " ")).toContain(
      "--resolve reply and resolve that Story thread; requires --reply-to and --body",
    );
    expect(help.stdout.replace(/\s+/g, " ")).toContain(
      "--kind <question> start a question thread; new Story thread root only",
    );
  });

  it("links a Story thread to a Task with --link-task", async () => {
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("task-a", {
      kind: "task",
      title: "Fix guard",
      partOf: "s",
      order: 0,
      status: "todo",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeFileSync(
      join(dir, "s", "comments.jsonl"),
      `${JSON.stringify({
        id: "root-id",
        role: "story-review",
        body: "fix the guard",
        at: nextAt(),
      })}\n`,
    );

    const { stdout, status } = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "human",
        "--reply-to",
        "root-id",
        "--link-task",
        "task-a",
      ],
      { env: env() },
    );
    expect(status).toBe(0);
    expect(stdout).toBe("");

    const lines = readFileSync(join(dir, "s", "comments.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      type: "thread-event",
      threadId: "root-id",
      event: "linked",
      taskId: "task-a",
      by: { role: "human" },
    });
  });

  it("prints Story thread state, including a resolved link, on view --comments", async () => {
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("task-open", {
      kind: "task",
      title: "Still open",
      partOf: "s",
      order: 0,
      status: "in-progress",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("task-done", {
      kind: "task",
      title: "Already done",
      partOf: "s",
      order: 1,
      status: "done",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const at = nextAt();
    writeFileSync(
      join(dir, "s", "comments.jsonl"),
      [
        JSON.stringify({
          id: "open-root",
          role: "story-review",
          body: "fix the guard",
          at,
        }),
        JSON.stringify({
          id: "resolved-root",
          role: "story-review",
          body: "name the helper",
          at,
        }),
      ].join("\n") + "\n",
    );

    const linkOpen = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "human",
        "--reply-to",
        "open-root",
        "--link-task",
        "task-open",
      ],
      { env: env() },
    );
    expect(linkOpen.status).toBe(0);
    const linkDone = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "human",
        "--reply-to",
        "resolved-root",
        "--link-task",
        "task-done",
      ],
      { env: env() },
    );
    expect(linkDone.status).toBe(0);
    const resolve = await runIssueCli(
      [
        "comment",
        "s",
        "--role",
        "implementor",
        "--body",
        "named the helper in thread-state.ts",
        "--reply-to",
        "resolved-root",
        "--resolve",
      ],
      { env: env() },
    );
    expect(resolve.status).toBe(0);

    const view = await runIssueCli(["story", "view", "s", "--comments"], {
      env: env(),
    });
    expect(view.status).toBe(0);
    expect(view.stdout.split("--- threads ---")[1]!.trim().split("\n")).toEqual([
      "open-root open linked=task-open",
      "resolved-root resolved linked=task-done",
    ]);

    const openRoots = await runIssueCli(
      ["task", "get", "task-open", "openLinkedThreadRoots"],
      { env: env() },
    );
    expect(openRoots.status).toBe(0);
    expect(openRoots.stdout).toBe("open-root\n");

    const doneRoots = await runIssueCli(
      ["task", "get", "task-done", "openLinkedThreadRoots"],
      { env: env() },
    );
    expect(doneRoots.status).toBe(0);
    expect(doneRoots.stdout).toBe("");

    const taskView = await runIssueCli(["task", "view", "task-open", "--comments"], {
      env: env(),
    });
    expect(taskView.status).toBe(0);
    expect(taskView.stdout).not.toContain("--- threads ---");
  });

  it("prints a converted question as a review thread with its history", async () => {
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const askedAt = nextAt();
    const answeredAt = nextAt();
    const convertedAt = nextAt();
    writeFileSync(
      join(dir, "s", "comments.jsonl"),
      [
        JSON.stringify({
          id: "q",
          role: "human",
          name: "Jared",
          kind: "question",
          body: "Does the guard consult remotes?",
          at: askedAt,
        }),
        JSON.stringify({
          id: "a",
          role: "agent",
          name: "Researcher",
          body: "Local refs only.",
          replyTo: "q",
          at: answeredAt,
        }),
        JSON.stringify({
          type: "thread-event",
          threadId: "q",
          event: "converted",
          by: { role: "human", name: "Jared" },
          at: convertedAt,
        }),
      ].join("\n") + "\n",
    );

    const view = await runIssueCli(["story", "view", "s", "--comments"], {
      env: env(),
    });
    expect(view.status).toBe(0);
    const comments = view.stdout.split("--- comments ---")[1]!.split("--- threads ---")[0]!;
    expect(comments).toContain("Does the guard consult remotes?");
    expect(comments).toContain("Local refs only.");
    expect(comments).toContain(
      `[${convertedAt}] Jared converted this question to a review comment`,
    );
    expect(view.stdout.split("--- threads ---")[1]!.trim()).toBe("q open");
  });

  it("refuses --link-task without --reply-to", async () => {
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 0,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });

    const missingReply = await runIssueCli(
      ["comment", "s", "--role", "human", "--link-task", "task-a"],
      { env: env() },
    );
    expect(missingReply.status).toBe(1);
    expect(missingReply.stderr).toContain("--link-task requires --reply-to");
  });

  it("supports anchor flags on kind-scoped comment", async () => {
    const { stdout, status } = await runIssueCli(
      [
        "task",
        "comment",
        "t",
        "--role",
        "agent",
        "--body",
        "scoped anchor",
        "--path",
        "app/cli-ops.ts",
        "--side",
        "old",
        "--line",
        "10",
        "--commit",
        COMMIT_SHA,
      ],
      { env: env() },
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(UUID_RE);

    const stored = JSON.parse(
      readFileSync(join(dir, "t", "comments.jsonl"), "utf8").trim(),
    );
    expect(stored.anchor?.side).toBe("old");
  });
});

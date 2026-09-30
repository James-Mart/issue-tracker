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

const AT = "2026-07-09T14:00:00.000Z";
let dir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "issue-tracker-thread-events-"));
  vi.resetModules();
  vi.stubEnv("ISSUES_DIR", dir);
  writeIssue("p", { kind: "project", title: "P", createdAt: AT, updatedAt: AT });
  writeIssue("s", {
    kind: "story",
    title: "Story",
    partOf: "p",
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  writeIssue("t", {
    kind: "task",
    title: "Task",
    partOf: "s",
    order: 0,
    status: "todo",
    createdAt: AT,
    updatedAt: AT,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function load() {
  const issues = await import("./issues.js");
  const events = await import("./thread-events.js");
  return { ...issues, ...events };
}

function logLines(id: string): unknown[] {
  return readFileSync(join(dir, id, "comments.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

describe("appendThreadEvent", () => {
  it("resolves with a reply in one write, then unresolve clears the state without a reply", async () => {
    const { appendComment, appendThreadEvent, readComments } = await load();
    const root = await appendComment("s", { role: "story-review", body: "fix this" });

    const resolved = await appendThreadEvent("s", root.id, {
      event: "resolved",
      by: { role: "human", name: "Jared" },
      body: "done",
    });
    expect(resolved.reply?.replyTo).toBe(root.id);
    expect(resolved.reply?.body).toBe("done");
    expect(resolved.reply?.name).toBe("Jared");
    expect(resolved.event).toMatchObject({
      type: "thread-event",
      threadId: root.id,
      event: "resolved",
      by: { role: "human", name: "Jared" },
    });
    expect(resolved.thread).toEqual({
      rootId: root.id,
      kind: "review",
      state: "resolved",
      readyToTask: false,
    });

    const lines = logLines("s");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatchObject({ replyTo: root.id, body: "done" });
    expect(lines[2]).toMatchObject({ type: "thread-event", event: "resolved" });

    const opened = await appendThreadEvent("s", root.id, {
      event: "unresolved",
      by: { role: "human" },
    });
    expect(opened.reply).toBeUndefined();
    expect(opened.thread.state).toBe("open");
    expect(readComments("s").messages).toHaveLength(2);
    expect(readComments("s").threads[0]?.state).toBe("open");
  });

  it("lets an agent resolve only with a reply, and never unresolve", async () => {
    const { appendComment, appendThreadEvent } = await load();
    const root = await appendComment("s", { role: "human", body: "root" });

    await expect(
      appendThreadEvent("s", root.id, {
        event: "resolved",
        by: { role: "implementor" },
      }),
    ).rejects.toThrow(/requires a reply body/);
    await expect(
      appendThreadEvent("s", root.id, {
        event: "unresolved",
        by: { role: "implementor" },
        body: "nope",
      }),
    ).rejects.toThrow(/cannot unresolve/);
    expect(readFileSync(join(dir, "s", "comments.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);

    const resolved = await appendThreadEvent("s", root.id, {
      event: "resolved",
      by: { role: "implementor" },
      body: "guard added in diff-fetch.ts",
    });
    expect(resolved.thread.state).toBe("resolved");
    expect(resolved.reply?.role).toBe("implementor");
  });

  it("refuses a non-Story, an unknown thread, and a reply id", async () => {
    const { appendComment, appendThreadEvent } = await load();
    const root = await appendComment("s", { role: "human", body: "root" });
    const reply = await appendComment("s", {
      role: "human",
      body: "reply",
      replyTo: root.id,
    });

    await expect(
      appendThreadEvent("t", root.id, {
        event: "resolved",
        by: { role: "human" },
      }),
    ).rejects.toThrow(/not a Story/);
    await expect(
      appendThreadEvent("s", "missing", {
        event: "resolved",
        by: { role: "human" },
      }),
    ).rejects.toThrow(/not a thread root/);
    await expect(
      appendThreadEvent("s", reply.id, {
        event: "unresolved",
        by: { role: "human" },
      }),
    ).rejects.toThrow(/not a thread root/);
  });

  it("links a thread to a Task under the Story", async () => {
    const { appendComment, appendThreadEvent, readComments } = await load();
    writeIssue("task-a", {
      kind: "task",
      title: "Fix guard",
      partOf: "s",
      order: 1,
      status: "todo",
      createdAt: AT,
      updatedAt: AT,
    });
    const root = await appendComment("s", { role: "story-review", body: "fix this" });

    const linked = await appendThreadEvent("s", root.id, {
      event: "linked",
      taskId: "task-a",
      by: { role: "human", name: "Jared" },
    });
    expect(linked.thread).toEqual({
      rootId: root.id,
      kind: "review",
      state: "open",
      linkedTaskId: "task-a",
      readyToTask: false,
    });
    expect(logLines("s")[1]).toMatchObject({
      type: "thread-event",
      event: "linked",
      taskId: "task-a",
    });

    writeIssue("other-task", {
      kind: "task",
      title: "Elsewhere",
      partOf: "p",
      order: 1,
      status: "todo",
      createdAt: AT,
      updatedAt: AT,
    });
    await expect(
      appendThreadEvent("s", root.id, {
        event: "linked",
        taskId: "other-task",
        by: { role: "human" },
      }),
    ).rejects.toThrow(/not under story/);
    expect(readComments("s").messages).toHaveLength(1);
  });

  it("reports an event for an unknown thread as a problem and keeps last-event state", async () => {
    const { readComments } = await load();
    writeFileSync(
      join(dir, "s", "comments.jsonl"),
      [
        JSON.stringify({
          id: "root",
          role: "human",
          body: "root",
          at: AT,
        }),
        JSON.stringify({
          type: "thread-event",
          threadId: "missing",
          event: "resolved",
          by: { role: "human" },
          at: AT,
        }),
        JSON.stringify({
          type: "thread-event",
          threadId: "root",
          event: "resolved",
          by: { role: "human" },
          at: AT,
        }),
        JSON.stringify({
          type: "thread-event",
          threadId: "root",
          event: "unresolved",
          by: { role: "human" },
          at: AT,
        }),
        JSON.stringify({
          type: "thread-event",
          threadId: "root",
          event: "resolved",
          by: { role: "human" },
          at: AT,
        }),
      ].join("\n") + "\n",
    );

    const comments = readComments("s");
    expect(comments.problems.map((problem) => problem.message)).toEqual([
      'thread event references unknown thread "missing"',
    ]);
    expect(comments.threads).toEqual([
      { rootId: "root", kind: "review", state: "resolved", readyToTask: false },
    ]);
    expect(comments.messages).toHaveLength(1);
  });

  it("lets a human dismiss and reopen a question without a reply", async () => {
    const { appendComment, appendThreadEvent, readComments } = await load();
    const root = await appendComment("s", {
      role: "human",
      body: "Does this short-circuit?",
      kind: "question",
    });

    const dismissed = await appendThreadEvent("s", root.id, {
      event: "dismissed",
      by: { role: "human", name: "Jared" },
    });
    expect(dismissed.reply).toBeUndefined();
    expect(dismissed.event).toMatchObject({
      type: "thread-event",
      threadId: root.id,
      event: "dismissed",
      by: { role: "human", name: "Jared" },
    });
    expect(dismissed.thread).toEqual({
      rootId: root.id,
      kind: "question",
      state: "dismissed",
      readyToTask: false,
    });

    const reopened = await appendThreadEvent("s", root.id, {
      event: "reopened",
      by: { role: "human" },
    });
    expect(reopened.thread).toEqual({
      rootId: root.id,
      kind: "question",
      state: "open",
      readyToTask: false,
    });
    expect(readComments("s").messages).toHaveLength(1);
  });

  it("refuses dismiss and reopen from an agent, and on a review thread", async () => {
    const { appendComment, appendThreadEvent } = await load();
    const review = await appendComment("s", { role: "human", body: "fix this" });
    const question = await appendComment("s", {
      role: "human",
      body: "why?",
      kind: "question",
    });

    await expect(
      appendThreadEvent("s", question.id, {
        event: "dismissed",
        by: { role: "implementor" },
      }),
    ).rejects.toThrow(/only a human can dismiss or reopen/);
    await expect(
      appendThreadEvent("s", review.id, {
        event: "dismissed",
        by: { role: "human" },
      }),
    ).rejects.toThrow(/only to a question thread/);
    await expect(
      appendThreadEvent("s", question.id, {
        event: "resolved",
        by: { role: "human" },
      }),
    ).rejects.toThrow(/only to a review thread/);
    expect(readFileSync(join(dir, "s", "comments.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("records the latest researcher session on a question, and refuses it on a review thread", async () => {
    const { appendComment, appendThreadEvent, readComments } = await load();
    const review = await appendComment("s", { role: "human", body: "fix this" });
    const question = await appendComment("s", {
      role: "human",
      body: "why?",
      kind: "question",
    });
    const researcher = { role: "agent", name: "Researcher" };

    await appendThreadEvent("s", question.id, {
      event: "researcher-session",
      conversationId: "conv-1",
      by: researcher,
    });
    const second = await appendThreadEvent("s", question.id, {
      event: "researcher-session",
      conversationId: "conv-2",
      by: researcher,
    });
    expect(second.event).toMatchObject({
      type: "thread-event",
      event: "researcher-session",
      conversationId: "conv-2",
      by: researcher,
    });
    expect(readComments("s").threads[1]).toEqual({
      rootId: question.id,
      kind: "question",
      state: "open",
      researcherConversationId: "conv-2",
      readyToTask: false,
    });

    await expect(
      appendThreadEvent("s", review.id, {
        event: "researcher-session",
        conversationId: "conv-3",
        by: researcher,
      }),
    ).rejects.toThrow(/only to a question thread/);
    await expect(
      appendThreadEvent("s", question.id, {
        event: "researcher-session",
        by: researcher,
      }),
    ).rejects.toThrow(/requires conversationId/);
    expect(logLines("s")).toHaveLength(4);
  });
});

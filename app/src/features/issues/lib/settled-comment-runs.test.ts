import { describe, expect, it } from "vitest";
import type { CommentThread } from "./comment-threads";
import {
  commentInThreads,
  commentListEntries,
  runIdContaining,
} from "./settled-comment-runs";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

function thread(
  id: string,
  overrides: Partial<CommentThread> = {},
): CommentThread {
  return {
    kind: "review",
    state: "resolved",
    readyToTask: false,
    root: {
      id,
      at: "2026-08-30T12:00:00.000Z",
      role: "story-review",
      body: id,
      anchor: { path: "a.ts", side: "new", line: 1, commitSha: SHA },
    },
    replies: [],
    ...overrides,
  };
}

function note(id: string): CommentThread {
  return thread(id, {
    state: "open",
    root: {
      id,
      at: "2026-08-30T12:00:00.000Z",
      role: "human",
      body: id,
    },
  });
}

function dismissed(id: string): CommentThread {
  return thread(id, {
    kind: "question",
    state: "dismissed",
    root: {
      id,
      at: "2026-08-30T12:00:00.000Z",
      role: "human",
      kind: "question",
      body: id,
    },
  });
}

describe("commentListEntries", () => {
  it("folds two or more consecutive resolved review threads", () => {
    const entries = commentListEntries([thread("a"), thread("b"), thread("c")]);
    expect(entries).toEqual([
      {
        kind: "run",
        id: "a",
        title: "3 resolved comments",
        threads: [thread("a"), thread("b"), thread("c")],
      },
    ]);
  });

  it("folds dismissed questions and names a mix as closed comments", () => {
    const entries = commentListEntries([dismissed("q1"), dismissed("q2")]);
    expect(entries[0]).toMatchObject({ kind: "run", title: "2 dismissed questions" });

    const mixed = commentListEntries([thread("a"), dismissed("q"), thread("b")]);
    expect(mixed[0]).toMatchObject({
      kind: "run",
      title: "3 closed comments",
      threads: [thread("a"), dismissed("q"), thread("b")],
    });
  });

  it("leaves a single settled thread in the stream", () => {
    const entries = commentListEntries([thread("only"), note("gap"), dismissed("q")]);
    expect(entries.map((entry) => entry.kind)).toEqual(["thread", "thread", "thread"]);
  });

  it("starts a new run at an open comment, a plain note, or anything else", () => {
    const open = thread("open", { state: "open" });
    const question = dismissed("ask");
    question.state = "open";
    const resolvedQuestion = dismissed("resolved-q");
    resolvedQuestion.state = "resolved";
    const entries = commentListEntries([
      thread("a"),
      thread("b"),
      note("note"),
      thread("c"),
      thread("d"),
      open,
      dismissed("q1"),
      dismissed("q2"),
      question,
      resolvedQuestion,
      thread("e"),
      thread("f"),
    ]);
    expect(entries.map((entry) => (entry.kind === "run" ? entry.title : entry.thread.root.id))).toEqual([
      "2 resolved comments",
      "note",
      "2 resolved comments",
      "open",
      "2 dismissed questions",
      "ask",
      "resolved-q",
      "2 resolved comments",
    ]);
  });

  it("finds a comment inside a run without folding the other run", () => {
    const reply = thread("a");
    reply.replies = [
      {
        id: "a-reply",
        at: "2026-08-30T13:00:00.000Z",
        role: "human",
        body: "reply",
        replyTo: "a",
      },
    ];
    const threads = [reply, thread("b"), note("note"), dismissed("q1"), dismissed("q2")];
    const entries = commentListEntries(threads);
    expect(commentInThreads(threads, "a-reply")?.thread.root.id).toBe("a");
    expect(runIdContaining(entries, "a")).toBe("a");
    expect(runIdContaining(entries, "q2")).toBe("q1");
    expect(runIdContaining(entries, "note")).toBeNull();
  });
});

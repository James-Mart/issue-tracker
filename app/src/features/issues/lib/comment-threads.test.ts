import { describe, expect, it, vi } from "vitest";
import type { CommentMessage } from "@server/schemas";
import {
  formatAnchorLineLabel,
  groupCommentThreads,
  isPlainNote,
  selectAnchoredThreads,
  threadStateActions,
} from "./comment-threads";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body">,
): CommentMessage {
  return {
    role: "human",
    ...overrides,
  };
}

describe("groupCommentThreads", () => {
  it("groups replies under their root in append order and sorts threads by root at", () => {
    const lateRoot = comment({
      id: "late",
      at: "2026-08-30T14:00:00.000Z",
      role: "story-review",
      body: "later root",
    });
    const earlyRoot = comment({
      id: "early",
      at: "2026-08-29T09:00:00.000Z",
      role: "story-review",
      body: "early root",
    });
    const secondReply = comment({
      id: "r2",
      at: "2026-08-30T15:00:00.000Z",
      replyTo: "late",
      body: "second reply",
    });
    const firstReply = comment({
      id: "r1",
      at: "2026-08-30T14:30:00.000Z",
      replyTo: "late",
      body: "first reply",
    });

    const threads = groupCommentThreads([
      lateRoot,
      firstReply,
      secondReply,
      earlyRoot,
    ]);

    expect(threads.map((thread) => thread.root.id)).toEqual(["early", "late"]);
    expect(threads[1]?.replies.map((reply) => reply.id)).toEqual(["r1", "r2"]);
    expect(threads[0]?.replies).toEqual([]);
    expect(threads.map((thread) => thread.state)).toEqual(["open", "open"]);
    expect(threads.map((thread) => thread.readyToTask)).toEqual([true, true]);
  });

  it("applies derived thread state by root id", () => {
    const root = comment({
      id: "root",
      at: "2026-08-30T14:00:00.000Z",
      body: "root",
    });
    const threads = groupCommentThreads(
      [root],
      [
        {
          rootId: "root",
          kind: "review",
          state: "resolved",
          readyToTask: false,
        },
      ],
    );
    expect(threads[0]?.state).toBe("resolved");
    expect(threads[0]?.readyToTask).toBe(false);
  });

  it("maps linkedTaskId and readyToTask from thread views", () => {
    const root = comment({
      id: "root",
      at: "2026-08-30T14:00:00.000Z",
      body: "root",
    });
    const threads = groupCommentThreads(
      [root],
      [
        {
          rootId: "root",
          kind: "review",
          state: "open",
          linkedTaskId: "task-a",
          readyToTask: false,
        },
      ],
    );
    expect(threads[0]?.linkedTaskId).toBe("task-a");
    expect(threads[0]?.readyToTask).toBe(false);
  });

  it("treats a question root as a thread even with no replies", () => {
    const root = comment({
      id: "asked",
      at: "2026-08-30T14:00:00.000Z",
      body: "why?",
      kind: "question",
    });
    const threads = groupCommentThreads([root]);
    expect(threads[0]?.kind).toBe("question");
    expect(threads[0]?.readyToTask).toBe(false);
    expect(isPlainNote(threads[0]!)).toBe(false);
    expect(isPlainNote({ ...threads[0]!, kind: "review" })).toBe(true);
    expect(
      isPlainNote({
        ...threads[0]!,
        kind: "review",
        converted: {
          by: { role: "human", name: "Jared" },
          at: "2026-08-30T15:00:00.000Z",
        },
      }),
    ).toBe(false);
  });

  it("keeps conversion credit and review readiness from the thread view", () => {
    const root = comment({
      id: "asked",
      at: "2026-08-30T14:00:00.000Z",
      body: "why?",
      kind: "question",
    });
    const threads = groupCommentThreads(
      [root],
      [
        {
          rootId: "asked",
          kind: "review",
          state: "open",
          readyToTask: true,
          converted: {
            by: { role: "human", name: "Jared" },
            at: "2026-08-30T15:00:00.000Z",
          },
        },
      ],
    );
    expect(threads[0]?.kind).toBe("review");
    expect(threads[0]?.readyToTask).toBe(true);
    expect(threads[0]?.converted?.by.name).toBe("Jared");
    const post = vi.fn();
    threadStateActions(threads[0]!, post);
    expect(post).not.toHaveBeenCalled();
    const question = { ...threads[0]!, kind: "question" as const };
    threadStateActions(question, post).onConvert?.();
    expect(post).toHaveBeenCalledWith("converted");
  });
});

describe("selectAnchoredThreads", () => {
  it("keys matching threads by the anchor end line", () => {
    const range = comment({
      id: "range",
      at: "2026-08-29T09:00:00.000Z",
      role: "story-review",
      body: "range",
      outdated: true,
      anchor: {
        path: "app/foo.ts",
        side: "old",
        line: 90,
        startLine: 88,
        commitSha: SHA,
      },
    });
    const current = comment({
      id: "line",
      at: "2026-08-30T14:00:00.000Z",
      role: "story-review",
      body: "line",
      anchor: {
        path: "app/foo.ts",
        side: "new",
        line: 94,
        commitSha: SHA,
      },
    });
    const otherFile = comment({
      id: "other",
      at: "2026-08-30T16:00:00.000Z",
      body: "other",
      anchor: {
        path: "app/bar.ts",
        side: "new",
        line: 94,
        commitSha: SHA,
      },
    });
    const threads = groupCommentThreads([range, current, otherFile]);

    const oldSide = selectAnchoredThreads(threads, "app/foo.ts", "old");
    expect([...oldSide.keys()]).toEqual([90]);
    expect(oldSide.get(90)?.map((thread) => thread.root.id)).toEqual(["range"]);

    const newSide = selectAnchoredThreads(threads, "app/foo.ts", "new");
    expect([...newSide.keys()]).toEqual([94]);
    expect(newSide.get(94)?.map((thread) => thread.root.id)).toEqual(["line"]);
  });

  it("leaves a file anchor off every line map", () => {
    const threads = groupCommentThreads([
      comment({
        id: "file",
        at: "2026-08-30T14:00:00.000Z",
        body: "whole file",
        anchor: { path: "app/foo.ts", commitSha: SHA },
      }),
    ]);
    expect(selectAnchoredThreads(threads, "app/foo.ts", "new").size).toBe(0);
    expect(selectAnchoredThreads(threads, "app/foo.ts", "old").size).toBe(0);
  });
});

describe("formatAnchorLineLabel", () => {
  it("labels a single line and a range", () => {
    expect(formatAnchorLineLabel({ line: 94 })).toBe("line 94");
    expect(formatAnchorLineLabel({ line: 90, startLine: 88 })).toBe(
      "lines 88-90",
    );
    expect(formatAnchorLineLabel({ line: 90, startLine: 90 })).toBe("line 90");
  });
});

import { describe, expect, it } from "vitest";
import type { CommentMessage } from "@server/schemas";
import {
  formatAnchorLineLabel,
  groupCommentThreads,
  selectAnchoredThreads,
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
      role: "code-quality-validator",
      body: "later root",
    });
    const earlyRoot = comment({
      id: "early",
      at: "2026-08-29T09:00:00.000Z",
      role: "code-quality-validator",
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
  });
});

describe("selectAnchoredThreads", () => {
  it("keys matching threads by the anchor end line", () => {
    const range = comment({
      id: "range",
      at: "2026-08-29T09:00:00.000Z",
      role: "code-quality-validator",
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
      role: "code-quality-validator",
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

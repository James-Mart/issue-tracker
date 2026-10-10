import { describe, expect, it } from "vitest";
import type { CommentMessage } from "@server/schemas";
import { groupCommentThreads } from "./comment-threads";

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
});

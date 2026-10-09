import { describe, expect, it } from "vitest";
import type { Comment, ThreadEvent } from "../schemas.js";
import { deriveThreadViews } from "./thread-state.js";

const AT = "2026-07-09T14:00:00.000Z";

function root(id: string): Comment {
  return { id, role: "story-review", body: "root", at: AT };
}

function event(
  threadId: string,
  name: ThreadEvent["event"],
  taskId?: string,
): ThreadEvent {
  return {
    type: "thread-event",
    threadId,
    event: name,
    ...(taskId ? { taskId } : {}),
    by: { role: "human" },
    at: AT,
  };
}

describe("deriveThreadViews task links", () => {
  it("derives linkedTaskId from linked events and readyToTask when open and unlinked", () => {
    const messages = [root("a"), root("b")];
    const events = [event("a", "linked", "task-a")];
    const derived = deriveThreadViews("story", messages, events);

    expect(derived.threads).toEqual([
      {
        rootId: "a",
        kind: "review",
        state: "open",
        linkedTaskId: "task-a",
        readyToTask: false,
      },
      {
        rootId: "b",
        kind: "review",
        state: "open",
        readyToTask: true,
      },
    ]);
  });
});

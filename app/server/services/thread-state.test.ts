import { describe, expect, it } from "vitest";
import type { Comment, TaskStatus, ThreadEvent } from "../schemas.js";
import { deriveThreadViews, openLinkedThreadRootIds } from "./thread-state.js";

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

  it("clears linkedTaskId on unresolved when the linked Task is done", () => {
    const messages = [root("a")];
    const events = [
      event("a", "linked", "task-a"),
      event("a", "resolved"),
      event("a", "unresolved"),
    ];
    const taskStatusById = new Map<string, TaskStatus>([["task-a", "done"]]);
    const derived = deriveThreadViews("story", messages, events, taskStatusById);

    expect(derived.threads[0]).toEqual({
      rootId: "a",
      kind: "review",
      state: "open",
      readyToTask: true,
    });
  });

  it("keeps linkedTaskId on unresolved when the linked Task is not done", () => {
    const messages = [root("a")];
    const events = [
      event("a", "linked", "task-a"),
      event("a", "resolved"),
      event("a", "unresolved"),
    ];
    const taskStatusById = new Map<string, TaskStatus>([["task-a", "in-progress"]]);
    const derived = deriveThreadViews("story", messages, events, taskStatusById);

    expect(derived.threads[0]).toEqual({
      rootId: "a",
      kind: "review",
      state: "open",
      linkedTaskId: "task-a",
      readyToTask: false,
    });
  });

  it("lists open thread roots linked to a Task", () => {
    const messages = [root("a"), root("b"), root("c")];
    const events = [
      event("a", "linked", "task-a"),
      event("b", "linked", "task-a"),
      event("b", "resolved"),
      event("c", "linked", "task-b"),
    ];
    const { threads } = deriveThreadViews("story", messages, events);
    expect(openLinkedThreadRootIds(threads, "task-a")).toEqual(["a"]);
    expect(openLinkedThreadRootIds(threads, "task-b")).toEqual(["c"]);
    expect(openLinkedThreadRootIds(threads, "task-missing")).toEqual([]);
  });

  it("sets readyToTask false on resolved threads even without a link", () => {
    const messages = [root("a")];
    const events = [event("a", "resolved")];
    const derived = deriveThreadViews("story", messages, events);

    expect(derived.threads[0]?.readyToTask).toBe(false);
  });
});

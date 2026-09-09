import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { currentChannelSession } from "../api/channel-sessions";
import { leafTasksOf } from "./derived";
import { overviewWorkLoopAction } from "./overview-work-loop-action";
import { channelSessionListItem as session } from "../test/channel-session-list-item";

const timestamps = {
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

function task(
  id: string,
  status: IssueRecord & { kind: "task" }["status"],
  overrides: Partial<IssueRecord & { kind: "task" }> = {},
): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf: "story",
    status,
    ...timestamps,
    ...overrides,
  };
}

function story(id: string, overrides: Partial<IssueRecord & { kind: "story" }> = {}): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "project",
    branchName: id,
    merged: false,
    ...timestamps,
    ...overrides,
  };
}

function epic(id: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "project",
    ...timestamps,
  };
}

describe("overviewWorkLoopAction", () => {
  it("returns start when there is no current session", () => {
    expect(
      overviewWorkLoopAction({
        liveRun: false,
        leafTasks: [],
        currentSession: undefined,
      }),
    ).toEqual({ action: "start" });
  });

  it("returns hidden while a live run is active", () => {
    expect(
      overviewWorkLoopAction({
        liveRun: true,
        leafTasks: [task("t1", "todo")],
        currentSession: session({ id: "live" }),
      }),
    ).toEqual({ action: "hidden" });
  });

  it("returns hidden when every leaf task is done", () => {
    const current = session({ id: "current" });
    expect(
      overviewWorkLoopAction({
        liveRun: false,
        leafTasks: [task("t1", "done"), task("t2", "done")],
        currentSession: current,
      }),
    ).toEqual({ action: "hidden" });
  });

  it("returns resume when an appended task is not done", () => {
    const current = session({ id: "current" });
    expect(
      overviewWorkLoopAction({
        liveRun: false,
        leafTasks: [
          task("done", "done"),
          task("appended", "todo", { appended: true }),
        ],
        currentSession: current,
      }),
    ).toEqual({ action: "resume", resumeSession: current });
  });

  it("returns resume for an epic leaf list with one unfinished task", () => {
    const e = epic("e1");
    const issues = [
      e,
      { ...story("s1"), partOf: "e1" },
      { ...task("t1", "done"), partOf: "s1" },
      { ...task("t2", "todo"), partOf: "s1" },
    ];
    const current = session({ id: "current" });
    expect(
      overviewWorkLoopAction({
        liveRun: false,
        leafTasks: leafTasksOf(e, issues),
        currentSession: current,
      }),
    ).toEqual({ action: "resume", resumeSession: current });
  });

  it("returns hidden when all tasks are done even if the story is unmerged", () => {
    const s = story("s1", { merged: false });
    const current = session({ id: "current" });
    expect(
      overviewWorkLoopAction({
        liveRun: false,
        leafTasks: [
          { ...task("t1", "done"), partOf: "s1" },
          { ...task("t2", "done"), partOf: "s1" },
        ],
        currentSession: current,
      }),
    ).toEqual({ action: "hidden" });
  });

  it("resumes the non-archived session when multiple sessions exist", () => {
    const sessions = [
      session({ id: "archived", archived: true, updatedAt: "2026-08-03T00:00:00.000Z" }),
      session({ id: "current", updatedAt: "2026-08-02T00:00:00.000Z" }),
    ];
    const current = currentChannelSession(sessions);
    expect(
      overviewWorkLoopAction({
        liveRun: false,
        leafTasks: [task("t1", "todo")],
        currentSession: current,
      }),
    ).toEqual({ action: "resume", resumeSession: current });
    expect(current?.id).toBe("current");
  });

  it("returns hidden when there is a current session and zero leaf tasks", () => {
    expect(
      overviewWorkLoopAction({
        liveRun: false,
        leafTasks: [],
        currentSession: session({ id: "current" }),
      }),
    ).toEqual({ action: "hidden" });
  });
});

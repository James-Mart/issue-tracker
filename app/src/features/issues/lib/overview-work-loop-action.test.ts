import { describe, expect, it } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { currentChannelSession } from "../api/channel-sessions";
import { overviewWorkLoopAction } from "./overview-work-loop-action";
import { channelSessionListItem as session } from "../test/channel-session-list-item";

const timestamps = {
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

const workFields = {
  order: 0,
  needsAttention: false,
  attentionReason: null,
  archived: false,
};

function task(id: string, status: TaskRecord["status"]): TaskRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf: "story",
    status,
    commits: [],
    ...workFields,
    ...timestamps,
  };
}

describe("overviewWorkLoopAction", () => {
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
});

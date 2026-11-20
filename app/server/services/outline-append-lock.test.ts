import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendPlanningIdle,
  seedAppendPlanningGraph,
  seedOutlinePlanner,
} from "./append-planning.test-helpers.js";
import {
  setupRunSequenceTest,
  teardownRunSequenceTest,
} from "./run-sequence.fixtures.js";

async function startAppendPlanning(ideaId: string) {
  const { createIssueChannelSession } = await import("./conversations.js");
  return createIssueChannelSession(
    {
      issueId: ideaId,
      channel: "planning",
      projectId: "platform",
      title: "Plan append",
      model: "composer-2.5",
      message: "Plan the append.",
    },
    appendPlanningIdle,
  );
}

beforeEach(() => {
  setupRunSequenceTest();
  seedAppendPlanningGraph(
    { id: "append-a", title: "Append A", order: 4 },
    [{ id: "append-b", title: "Append B", order: 5 }],
  );
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("outline append lock", () => {
  it("enforces the derived lock while an append Idea plans from the outline planner", async () => {
    seedOutlinePlanner();
    const { meta } = await startAppendPlanning("append-a");
    const { appendOutlineLock, refuseOutlinePlannerLockPrompt } = await import(
      "./outline-append-lock.js"
    );
    const { createIssueChannelSession } = await import("./conversations.js");
    const { IssueError } = await import("./errors.js");

    expect(appendOutlineLock("spec")).toEqual({
      outlineId: "spec",
      ideaId: "append-a",
      ideaTitle: "Append A",
    });
    expect(() => refuseOutlinePlannerLockPrompt("outline-planner")).toThrow(
      /is locked/,
    );
    expect(() => refuseOutlinePlannerLockPrompt(meta.id)).not.toThrow();
    await expect(
      createIssueChannelSession(
        {
          issueId: "append-b",
          channel: "planning",
          projectId: "platform",
          title: "Plan append B",
          model: "composer-2.5",
          message: "Start B",
        },
        appendPlanningIdle,
      ),
    ).rejects.toBeInstanceOf(IssueError);
    await expect(
      createIssueChannelSession(
        {
          issueId: "spec",
          channel: "planning",
          projectId: "platform",
          title: "Plan feature",
          model: "composer-2.5",
          outlineRole: "planner",
        },
        appendPlanningIdle,
      ),
    ).rejects.toBeInstanceOf(IssueError);
  });
});
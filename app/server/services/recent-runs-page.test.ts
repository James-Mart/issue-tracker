import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AT,
  AT_CHILD,
  AT_EARLY,
  AT_END,
  AT_LATE,
  AT_LATE_END,
  delegation,
  loadRecentRunsPage,
  loadRunSequence,
  prompt,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  toolCall,
  writeConversation,
  writeIssue,
  writeRunLiveMarker,
  writeWorkTree,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("recentRunsPage", () => {
  it("returns newest-first across conversations, honors limit, and matches each run's condition", async () => {
    writeConversation("conv-old", {
      meta: {
        channel: "implementing",
        issueId: "task-old",
        createdAt: AT_EARLY,
      },
      delegations: [
        delegation({
          delegationId: "del-old",
          agentId: "agent-old",
          role: "implementor",
          model: "composer-2.5",
          at: AT_EARLY,
          issueId: "task-old",
          parentCallId: "call-old",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-old", "running", AT_EARLY, 1),
        toolCall("call-old", "completed", AT_END, 2),
      ],
    });

    writeConversation("conv-new", {
      meta: {
        channel: "planning",
        issueId: "task-new",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-new",
          agentId: "agent-new",
          role: "planner",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-new",
          parentCallId: "call-new",
        }),
      ],
      transcript: [toolCall("call-new", "running", AT_LATE, 1)],
    });

    writeConversation("conv-failed", {
      meta: {
        title: "Failed run",
        createdAt: AT,
      },
      delegations: [
        delegation({
          delegationId: "del-fail",
          agentId: "agent-fail",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-fail",
          parentCallId: "call-fail",
          end: { status: "error", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-fail", "running", AT, 1),
        toolCall("call-fail", "error", AT_END, 2),
      ],
    });

    const recentRunsPage = await loadRecentRunsPage();
    const runSequence = await loadRunSequence();

    const all = recentRunsPage({ limit: 10 }).runs;
    expect(all.map((row) => row.conversationId)).toEqual([
      "conv-new",
      "conv-failed",
      "conv-old",
    ]);

    for (const row of all) {
      expect(row.condition).toBe(runSequence(row.conversationId).condition);
    }

    expect(all[0]).toMatchObject({
      conversationId: "conv-new",
      coordinatorLabel: "Stakeholder",
      issueId: "task-new",
      startedAt: AT_LATE,
      condition: "in-flight",
    });
    expect(all[1]).toMatchObject({
      conversationId: "conv-failed",
      coordinatorLabel: "Failed run",
      issueId: "task-fail",
      condition: "failed",
    });
    expect(all[2]).toMatchObject({
      conversationId: "conv-old",
      coordinatorLabel: "Coordinator",
      issueId: "task-old",
      condition: "completed",
    });

    expect(
      recentRunsPage({ limit: 2 }).runs.map((row) => row.conversationId),
    ).toEqual(["conv-new", "conv-failed"]);
  });

  it("uses the earliest delegation issue id when rows disagree", async () => {
    writeConversation("conv-mixed", {
      meta: { channel: "implementing", issueId: "first-issue", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-first",
          agentId: "agent-first",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "first-issue",
          parentCallId: "call-first",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-second",
          agentId: "agent-second",
          role: "validator",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "second-issue",
          parentCallId: "call-second",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-first", "running", AT, 1),
        toolCall("call-first", "completed", AT_END, 2),
        toolCall("call-second", "running", AT_LATE, 3),
        toolCall("call-second", "completed", AT_LATE, 4),
      ],
    });

    const recentRunsPage = await loadRecentRunsPage();
    expect(recentRunsPage({ limit: 1 }).runs[0]?.issueId).toBe("first-issue");
  });

  it("includes a conversation with no delegations via its session root", async () => {
    writeConversation("conv-root-only", {
      meta: {
        channel: "planning",
        issueId: "capture",
        createdAt: AT,
      },
      transcript: [prompt("approve outline", AT, 1)],
    });

    const recentRunsPage = await loadRecentRunsPage();
    const runSequence = await loadRunSequence();

    expect(recentRunsPage({ limit: 10 })).toEqual({
      runs: [
        {
          conversationId: "conv-root-only",
          coordinatorLabel: "Stakeholder",
          startedAt: AT,
          condition: runSequence("conv-root-only").condition,
          issueId: "capture",
        },
      ],
      nextCursor: null,
    });
  });

  it("hydrates transcript and delegations only for the newest limit slice", async () => {
    writeConversation("conv-oldest", {
      meta: { title: "Oldest", createdAt: AT_EARLY },
      delegations: [
        delegation({
          delegationId: "del-oldest",
          agentId: "agent-oldest",
          role: "implementor",
          model: "composer-2.5",
          at: AT_EARLY,
          issueId: "task-oldest",
          parentCallId: "call-oldest",
          end: { status: "completed", endedAt: AT },
        }),
      ],
      transcript: [
        toolCall("call-oldest", "running", AT_EARLY, 1),
        toolCall("call-oldest", "completed", AT, 2),
      ],
    });
    writeConversation("conv-old", {
      meta: { title: "Old", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-old",
          agentId: "agent-old",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-old",
          parentCallId: "call-old",
          end: { status: "error", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-old", "running", AT, 1),
        toolCall("call-old", "error", AT_END, 2),
      ],
    });
    writeConversation("conv-newer", {
      meta: {
        channel: "planning",
        issueId: "task-newer",
        createdAt: AT_CHILD,
      },
      delegations: [
        delegation({
          delegationId: "del-newer",
          agentId: "agent-newer",
          role: "planner",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "task-newer",
          parentCallId: "call-newer",
        }),
      ],
      transcript: [toolCall("call-newer", "running", AT_CHILD, 1)],
    });
    writeConversation("conv-newest", {
      meta: {
        channel: "implementing",
        issueId: "task-newest",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-newest-fail",
          agentId: "agent-newest-fail",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-newest",
          parentCallId: "call-newest-fail",
          end: { status: "error", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-newest-ok",
          agentId: "agent-newest-ok",
          role: "validator",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "task-newest",
          parentCallId: "call-newest-ok",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-newest-fail", "running", AT, 1),
        toolCall("call-newest-fail", "error", AT_END, 2),
        toolCall("call-newest-ok", "running", AT_CHILD, 3),
        toolCall("call-newest-ok", "completed", AT_LATE, 4),
      ],
    });

    const conversations = await import("./conversations.js");
    const readConversation = vi.spyOn(conversations, "readConversation");
    const readDelegations = vi.spyOn(conversations, "readDelegations");
    const { recentRunsPage } = await import("./run-sequence.js");

    const { runs } = recentRunsPage({ limit: 2 });
    const hydrated = new Set([
      ...readConversation.mock.calls.map(([id]) => id),
      ...readDelegations.mock.calls.map(([id]) => id),
    ]);

    expect([...hydrated].sort()).toEqual(["conv-newer", "conv-newest"]);
    expect(runs).toEqual([
      {
        conversationId: "conv-newest",
        coordinatorLabel: "Coordinator",
        startedAt: AT_LATE,
        condition: "completed",
        issueId: "task-newest",
        recoveredErrors: 1,
      },
      {
        conversationId: "conv-newer",
        coordinatorLabel: "Stakeholder",
        startedAt: AT_CHILD,
        condition: "in-flight",
        issueId: "task-newer",
      },
    ]);
  });

  it("derives list badges without reading the issue store or calling runSequence", async () => {
    writeWorkTree();
    writeIssue("task-on-disk", {
      kind: "task",
      title: "On disk",
      partOf: "story-one",
      createdAt: AT,
      updatedAt: AT,
    });

    writeConversation("conv-recovered", {
      meta: {
        channel: "implementing",
        issueId: "task-on-disk",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-fail",
          agentId: "agent-fail",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-on-disk",
          parentCallId: "call-fail",
          end: { status: "error", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-ok",
          agentId: "agent-ok",
          role: "validator",
          model: "composer-2.5",
          at: AT_CHILD,
          issueId: "task-on-disk",
          parentCallId: "call-ok",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-fail", "running", AT, 1),
        toolCall("call-fail", "error", AT_END, 2),
        toolCall("call-ok", "running", AT_CHILD, 3),
        toolCall("call-ok", "completed", AT_LATE, 4),
      ],
    });

    const issues = await import("./issues.js");
    const readAllSpy = vi.spyOn(issues, "readAll");
    const readIssueOrThrowSpy = vi.spyOn(issues, "readIssueOrThrow");
    const readSpy = vi.spyOn(issues, "read");
    const readDescriptionSpy = vi.spyOn(issues, "readDescription");

    const runSequenceModule = await import("./run-sequence.js");
    const runSequenceSpy = vi.spyOn(runSequenceModule, "runSequence");

    const { runs } = runSequenceModule.recentRunsPage({ limit: 10 });

    expect(readAllSpy).not.toHaveBeenCalled();
    expect(readIssueOrThrowSpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(readDescriptionSpy).not.toHaveBeenCalled();
    expect(runSequenceSpy).not.toHaveBeenCalled();

    expect(runs).toEqual([
      {
        conversationId: "conv-recovered",
        coordinatorLabel: "Coordinator",
        startedAt: AT_LATE,
        condition: "completed",
        issueId: "task-on-disk",
        recoveredErrors: 1,
      },
    ]);
  });

  it("reports in-flight when the run-live marker overrides a completed beat verdict", async () => {
    writeConversation("conv-live-list", {
      meta: {
        channel: "planning",
        issueId: "task-live",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-live",
          agentId: "agent-live",
          role: "planner",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-live",
          parentCallId: "call-live",
          end: { status: "completed", endedAt: AT_LATE_END },
        }),
      ],
      transcript: [
        toolCall("call-live", "running", AT_LATE, 1),
        toolCall("call-live", "completed", AT_LATE_END, 2),
      ],
    });
    writeRunLiveMarker("conv-live-list");

    const recentRunsPage = await loadRecentRunsPage();
    expect(recentRunsPage({ limit: 1 }).runs[0]?.condition).toBe("in-flight");
  });

  it("reports completed from recentRunsPage when no run-live marker is present", async () => {
    writeConversation("conv-completed-list", {
      meta: {
        channel: "planning",
        issueId: "task-done",
        createdAt: AT_LATE,
      },
      delegations: [
        delegation({
          delegationId: "del-done",
          agentId: "agent-done",
          role: "planner",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-done",
          parentCallId: "call-done",
          end: { status: "completed", endedAt: AT_LATE_END },
        }),
      ],
      transcript: [
        toolCall("call-done", "running", AT_LATE, 1),
        toolCall("call-done", "completed", AT_LATE_END, 2),
      ],
    });

    const recentRunsPage = await loadRecentRunsPage();
    expect(recentRunsPage({ limit: 1 }).runs[0]?.condition).toBe("completed");
  });

  it("pages newest-first with a nextCursor, no overlap or gap, and null at the end", async () => {
    writeConversation("conv-a", {
      meta: { title: "A", createdAt: AT_EARLY },
      transcript: [prompt("hi", AT_EARLY, 1)],
    });
    writeConversation("conv-b", {
      meta: { title: "B", createdAt: AT },
      transcript: [prompt("hi", AT, 1)],
    });
    writeConversation("conv-c", {
      meta: { title: "C", createdAt: AT_LATE },
      transcript: [prompt("hi", AT_LATE, 1)],
    });

    const recentRunsPage = await loadRecentRunsPage();

    const first = recentRunsPage({ limit: 2 });
    expect(first.runs.map((row) => row.conversationId)).toEqual([
      "conv-c",
      "conv-b",
    ]);
    expect(first.nextCursor).toBe(`${AT}|conv-b`);

    const second = recentRunsPage({ limit: 2, cursor: first.nextCursor! });
    expect(second.runs.map((row) => row.conversationId)).toEqual(["conv-a"]);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.runs, ...second.runs].map((row) => row.conversationId);
    expect(ids).toEqual(["conv-c", "conv-b", "conv-a"]);
  });

  it("pages conversations that share a createdAt by conversationId descending", async () => {
    writeConversation("conv-a", {
      meta: { title: "A", createdAt: AT },
      transcript: [prompt("hi", AT, 1)],
    });
    writeConversation("conv-z", {
      meta: { title: "Z", createdAt: AT },
      transcript: [prompt("hi", AT, 1)],
    });

    const recentRunsPage = await loadRecentRunsPage();

    const first = recentRunsPage({ limit: 1 });
    expect(first.runs.map((row) => row.conversationId)).toEqual(["conv-z"]);
    expect(first.nextCursor).toBe(`${AT}|conv-z`);

    const second = recentRunsPage({ limit: 1, cursor: first.nextCursor! });
    expect(second.runs.map((row) => row.conversationId)).toEqual(["conv-a"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    const recentRunsPage = await loadRecentRunsPage();
    expect(() =>
      recentRunsPage({ limit: 1, cursor: "not-a-cursor" }),
    ).toThrow(/cursor must be createdAt\|conversationId/);
    try {
      recentRunsPage({ limit: 1, cursor: "not-a-cursor" });
    } catch (err) {
      expect(err).toMatchObject({
        code: "validation",
        message: "cursor must be createdAt|conversationId",
      });
    }
  });
});

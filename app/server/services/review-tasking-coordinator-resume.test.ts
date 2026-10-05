import { describe, expect, it } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import {
  AT,
  REVIEW_ID,
  seedReviewTasking as seed,
  useReviewTaskingStore,
  writeReviewSubmissions,
  writeReviewTaskingIssue,
} from "./review-tasking.test-fixtures.js";

function stubSessions(prompts: string[]): AgentSessions {
  return {
    getActiveRun: () => undefined,
    sendPrompt: async (_id: string, options: { prompt: string }) => {
      prompts.push(options.prompt);
      return { ok: true as const, run: { id: "run-1" } as never };
    },
  } as unknown as AgentSessions;
}

async function load() {
  const tasking = await import("./review-tasking.js");
  const threads = await import("./thread-events.js");
  const issues = await import("./issues.js");
  const reviews = await import("./reviews.js");
  return { ...reviews, ...tasking, ...threads, ...issues };
}

async function linkTask(commentId: string, taskId: string, at: string): Promise<void> {
  const later = new Date(Date.parse(at) + 1000).toISOString();
  writeReviewTaskingIssue(taskId, {
    kind: "task",
    title: taskId,
    partOf: "s",
    status: "todo",
    order: 1,
    createdAt: later,
    updatedAt: later,
  });
  const { appendThreadEvent } = await load();
  await appendThreadEvent("s", commentId, {
    event: "linked",
    taskId,
    by: { role: "human" },
  });
}

describe("coordinator resume once per submission", () => {
  useReviewTaskingStore("issue-tracker-coordinator-resume-");

  it("records coordinatorResumed when a mid-turn steer falls back to a queued follow-up", async () => {
    seed();
    const prompts: string[] = [];
    const { createConversation, readConversation } = await import("./conversations.js");
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      appendThreadEvent,
      classifyReviewTaskingRun,
    } = await load();
    const implementing = await createConversation({
      title: "Implement E",
      projectId: "p",
      model: "composer-2.5",
      issueId: "e",
      channel: "implementing",
    });
    const rootComment = await appendComment("s", { role: "human", body: "Fix" });
    const sessions = {
      getActiveRun: (id: string) =>
        id === implementing.id
          ? {
              id: "run",
              startedAt: AT,
              steer: async () => "revert_to_followup" as const,
            }
          : undefined,
      sendPrompt: async (_id: string, options: { prompt: string }) => {
        prompts.push(options.prompt);
        return { ok: true as const, run: { id: "run-1" } as never };
      },
    } as unknown as AgentSessions;
    const recordedView = await submitReview("p", REVIEW_ID, {});
    await launchRecordedSubmission(
      "p",
      REVIEW_ID,
      recordedView.submissions[0]!.id,
      "start",
      sessions,
    );
    const recorded = readReviewView("p", REVIEW_ID).submissions[0]!;
    const later = new Date(Date.parse(recorded.at) + 1000).toISOString();
    writeReviewTaskingIssue("fix-it", {
      kind: "task",
      title: "Fix",
      partOf: "s",
      status: "todo",
      order: 1,
      createdAt: later,
      updatedAt: later,
    });
    await appendThreadEvent("s", rootComment.id, {
      event: "linked",
      taskId: "fix-it",
      by: { role: "issue-tracker-review-tasker" },
    });
    await classifyReviewTaskingRun(
      recorded.conversationId!,
      { status: "finished" },
      sessions,
    );

    const { implementingResumePrompt } = await import("./implementing-launch.js");
    expect(readReviewView("p", REVIEW_ID).submissions[0]).toMatchObject({
      status: "done",
      taskIds: ["fix-it"],
      coordinatorResumed: true,
    });
    expect(readConversation(implementing.id).meta.pendingMessage?.text).toBe(
      implementingResumePrompt(),
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Story: s");
  });

  it("keeps coordinatorResumed when a submission returns to tasking", async () => {
    seed();
    const prompts: string[] = [];
    const { appendComment, retryOpenReviewSubmissions } = await load();
    const open = await appendComment("s", { role: "human", body: "Open" });
    writeReviewSubmissions([
      {
        id: "sub-open",
        at: AT,
        status: "incomplete",
        threadIds: [open.id],
        coordinatorResumed: true,
      },
    ]);

    const view = await retryOpenReviewSubmissions(
      "p",
      REVIEW_ID,
      {},
      stubSessions(prompts),
    );

    expect(view.submissions[0]).toMatchObject({
      id: "sub-open",
      status: "tasking",
      coordinatorResumed: true,
    });
    expect(prompts).toEqual([]);
  });

  it("does not bring the coordinator in again when the field is already set", async () => {
    seed();
    const prompts: string[] = [];
    const { appendComment, retryReviewSubmission } = await load();
    const handled = await appendComment("s", { role: "human", body: "Handled" });
    await linkTask(handled.id, "task-a", AT);
    writeReviewSubmissions([
      {
        id: "sub-done",
        at: AT,
        status: "incomplete",
        threadIds: [handled.id],
        coordinatorResumed: true,
      },
    ]);

    const view = await retryReviewSubmission(
      "p",
      REVIEW_ID,
      "sub-done",
      {},
      stubSessions(prompts),
    );

    expect(view.submissions[0]).toMatchObject({
      status: "done",
      taskIds: ["task-a"],
      coordinatorResumed: true,
    });
    expect(prompts).toEqual([]);
  });

  it("brings the coordinator in once for each submission that finishes together", async () => {
    seed();
    const prompts: string[] = [];
    const { appendComment, retryOpenReviewSubmissions } = await load();
    const first = await appendComment("s", { role: "human", body: "First" });
    const second = await appendComment("s", { role: "human", body: "Second" });
    await linkTask(first.id, "task-a", AT);
    await linkTask(second.id, "task-b", AT);
    writeReviewSubmissions([
      {
        id: "sub-a",
        at: AT,
        status: "incomplete",
        threadIds: [first.id],
      },
      {
        id: "sub-b",
        at: AT,
        status: "failed",
        threadIds: [second.id],
        error: "tasker exploded",
      },
    ]);

    const view = await retryOpenReviewSubmissions(
      "p",
      REVIEW_ID,
      {},
      stubSessions(prompts),
    );

    const { implementingResumePrompt, implementingSessionMessage } = await import(
      "./implementing-launch.js"
    );
    const resume = implementingResumePrompt();
    expect(view.submissions).toEqual([
      expect.objectContaining({
        id: "sub-a",
        status: "done",
        taskIds: ["task-a"],
        coordinatorResumed: true,
      }),
      expect.objectContaining({
        id: "sub-b",
        status: "done",
        taskIds: ["task-b"],
        coordinatorResumed: true,
      }),
    ]);
    expect(prompts).toEqual([
      `${implementingSessionMessage("e")}\n\n${resume}`,
      resume,
    ]);
  });

  it("resumes the next submission when an earlier bring-in throws", async () => {
    seed();
    const prompts: string[] = [];
    let calls = 0;
    const { appendComment, retryOpenReviewSubmissions } = await load();
    const first = await appendComment("s", { role: "human", body: "First" });
    const second = await appendComment("s", { role: "human", body: "Second" });
    await linkTask(first.id, "task-a", AT);
    await linkTask(second.id, "task-b", AT);
    writeReviewSubmissions([
      {
        id: "sub-a",
        at: AT,
        status: "incomplete",
        threadIds: [first.id],
      },
      {
        id: "sub-b",
        at: AT,
        status: "incomplete",
        threadIds: [second.id],
      },
    ]);
    const sessions = {
      getActiveRun: () => undefined,
      sendPrompt: async (_id: string, options: { prompt: string }) => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false as const,
            cause: "never_started" as const,
            error: new Error("coordinator down") as never,
          };
        }
        prompts.push(options.prompt);
        return { ok: true as const, run: { id: "run-1" } as never };
      },
    } as unknown as AgentSessions;

    const view = await retryOpenReviewSubmissions("p", REVIEW_ID, {}, sessions);

    const { implementingResumePrompt } = await import("./implementing-launch.js");
    expect(view.submissions[0]).toMatchObject({ id: "sub-a", status: "done" });
    expect(view.submissions[0]).not.toHaveProperty("coordinatorResumed");
    expect(view.submissions[1]).toMatchObject({
      id: "sub-b",
      status: "done",
      coordinatorResumed: true,
    });
    expect(prompts).toEqual([implementingResumePrompt()]);
  });
});

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import type { ReviewSubmission } from "../schemas/review.js";
import { TASKING_INCOMPLETE_REASON } from "../review-submission-status.js";
import {
  AT,
  REVIEW_ID,
  reviewTaskingIssuesDir,
  seedReviewTasking as seed,
  useReviewTaskingStore,
  writeReviewTaskingIssue as writeIssue,
} from "./review-tasking.test-fixtures.js";

function stubSessions(prompts: string[], failMessage?: string): AgentSessions {
  return {
    getActiveRun: () => undefined,
    sendPrompt: async (_id: string, options: { prompt: string }) => {
      prompts.push(options.prompt);
      if (failMessage) {
        return {
          ok: false as const,
          cause: "never_started" as const,
          error: new Error(failMessage) as never,
        };
      }
      return { ok: true as const, run: { id: "run-1" } as never };
    },
  } as unknown as AgentSessions;
}

function submission(view: { submissions: ReviewSubmission[] }): ReviewSubmission {
  return view.submissions[0]!;
}

function requireConversation(recorded: ReviewSubmission): string {
  if (!recorded.conversationId) throw new Error("expected tasker conversation");
  return recorded.conversationId;
}

async function launchRecorded(
  api: {
    launchRecordedSubmission: (
      projectId: string,
      reviewId: string,
      submissionId: string,
      kind: "start" | "retry",
      sessions: AgentSessions,
    ) => Promise<void>;
    readReviewView: (
      projectId: string,
      reviewId: string,
    ) => { submissions: ReviewSubmission[] };
  },
  recorded: { submissions: ReviewSubmission[] },
  sessions: AgentSessions,
  kind: "start" | "retry" = "start",
) {
  await api.launchRecordedSubmission(
    "p",
    REVIEW_ID,
    submission(recorded).id,
    kind,
    sessions,
  );
  return api.readReviewView("p", REVIEW_ID);
}

async function load() {
  const tasking = await import("./review-tasking.js");
  const issues = await import("./issues.js");
  const threads = await import("./thread-events.js");
  const runs = await import("./agent-runs.js");
  const reviews = await import("./reviews.js");
  return { ...reviews, ...tasking, ...issues, ...threads, ...runs };
}

describe("review tasking", () => {
  useReviewTaskingStore("issue-tracker-review-tasking-");

  it("posts a summary, records a tasking submission, and starts the tasker", async () => {
    seed();
    const prompts: string[] = [];
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      readComments,
      SUBMISSION_TASKING_ERROR,
      REVIEW_TASKER_ROLE,
      reviewTaskerDelegationId,
      listAgentRunsForIssue,
      listAgentRunEvents,
    } = await load();
    const first = await appendComment("s", { role: "human", body: "Fix the anchor" });
    const second = await appendComment("s", { role: "human", body: "And the name" });
    const sessions = stubSessions(prompts);

    const recordedView = await submitReview("p", REVIEW_ID, { summary: "Ship the wording" });
    expect(submission(recordedView)).toMatchObject({
      status: "tasking",
      threadIds: [first.id, second.id],
    });
    expect(submission(recordedView).conversationId).toBeUndefined();
    expect(prompts).toHaveLength(0);

    const view = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const recorded = submission(view);
    expect(recorded.status).toBe("tasking");
    expect(recorded.summaryCommentId).toBe(submission(recordedView).summaryCommentId);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(`Story: s`);
    expect(prompts[0]).toContain(`Threads: ${first.id}, ${second.id}`);
    expect(prompts[0]).toContain(`Summary comment: ${recorded.summaryCommentId}`);
    expect(prompts[0]).toContain("issue-tracker-review-tasker");

    const comments = readComments("s");
    expect(comments.messages.map((message) => message.body)).toContain(
      "Ship the wording",
    );

    await expect(submitReview("p", REVIEW_ID, {})).rejects.toThrow(SUBMISSION_TASKING_ERROR);

    const runs = listAgentRunsForIssue("s");
    expect(runs.map((run) => run.role)).toEqual([REVIEW_TASKER_ROLE]);
    expect(runs[0]?.conversationId).toBe(requireConversation(recorded));
    expect(runs[0]?.status).toBe("unknown");
    expect(
      listAgentRunEvents("s", reviewTaskerDelegationId(requireConversation(recorded))),
    ).toEqual([]);
  });

  it("claims only submission-named conversations on the shared review channel", async () => {
    seed();
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      REVIEW_TASKER_ROLE,
      reviewTaskerDelegationId,
      listAgentRunsForIssue,
      listAgentRunEvents,
    } = await load();
    const { createConversation, readConversation } = await import(
      "./conversations.js"
    );
    const { REVIEW_QUESTION_ROLE, isQuestionResearcherConversation } =
      await import("./researcher-runs.js");
    await appendComment("s", { role: "human", body: "Fix it" });
    const sessions = stubSessions([]);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const view = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const tasker = readConversation(requireConversation(submission(view))).meta;
    const researcher = await createConversation({
      title: "Researcher: why?",
      projectId: "p",
      model: "composer-2.5",
      issueId: "s",
      channel: "review",
      role: REVIEW_QUESTION_ROLE,
    });

    expect(tasker.role).toBe(REVIEW_TASKER_ROLE);
    expect(listAgentRunsForIssue("s").map((run) => run.conversationId)).toEqual([
      tasker.id,
    ]);
    expect(
      listAgentRunEvents("s", reviewTaskerDelegationId(researcher.id)),
    ).toBeUndefined();
    expect(isQuestionResearcherConversation(tasker)).toBe(false);
    expect(isQuestionResearcherConversation(researcher)).toBe(true);
  });

  it("refuses a merged story and a story with no ready threads", async () => {
    seed({ merged: true });
    const { submitReview, appendComment, mergedStoryTaskingError, NO_READY_THREADS_ERROR } =
      await load();
    await appendComment("s", { role: "human", body: "Still open" });
    await expect(submitReview("p", REVIEW_ID, {})).rejects.toThrow(
      mergedStoryTaskingError("s"),
    );

    writeFileSync(
      join(reviewTaskingIssuesDir(), "s", "issue.json"),
      JSON.stringify({
        id: "s",
        kind: "story",
        title: "S",
        partOf: "e",
        order: 0,
        merged: false,
        createdAt: AT,
        updatedAt: AT,
      }),
    );
    writeFileSync(join(reviewTaskingIssuesDir(), "s", "comments.jsonl"), "");
    await expect(submitReview("p", REVIEW_ID, { summary: "   " })).rejects.toThrow(
      NO_READY_THREADS_ERROR,
    );
    expect(readFileSync(join(reviewTaskingIssuesDir(), "s", "comments.jsonl"), "utf8")).toBe("");
  });

  it("records a failed submission when the tasker does not start", async () => {
    seed();
    const { submitReview, launchRecordedSubmission, readReviewView, appendComment } =
      await load();
    await appendComment("s", { role: "human", body: "Fix it" });
    const sessions = stubSessions([], "sdk down");
    const recordedView = await submitReview("p", REVIEW_ID, {});
    expect(submission(recordedView).status).toBe("tasking");
    const view = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    expect(submission(view)).toMatchObject({
      status: "failed",
      error: "sdk down",
    });
    expect(submission(view).conversationId).toBeDefined();
    expect(submission(view).summaryCommentId).toBeUndefined();
  });

  it("records classification failure on the tasking submission", async () => {
    seed();
    const {
      submitReview,
      launchRecordedSubmission,
      appendComment,
      failReviewTaskingClassification,
      readReviewView,
    } = await load();
    await appendComment("s", { role: "human", body: "Fix it" });
    const sessions = stubSessions([]);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const view = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const recorded = submission(view);
    const conversationId = requireConversation(recorded);
    expect(failReviewTaskingClassification(conversationId, "classify boom")).toBe(true);
    expect(submission(readReviewView("p", REVIEW_ID))).toMatchObject({
      status: "failed",
      error: "classify boom",
    });
    expect(
      failReviewTaskingClassification(conversationId, "again"),
    ).toBe(false);
  });

  it("classifies a finished run from new task links and retries what is still unlinked", async () => {
    seed();
    const prompts: string[] = [];
    const {
      submitReview,
      launchRecordedSubmission,
      appendComment,
      classifyReviewTaskingRun,
      retryReviewSubmission,
      readReviewView,
      appendThreadEvent,
      listAgentRunsForIssue,
    } = await load();
    const kept = await appendComment("s", { role: "human", body: "Keep" });
    const missed = await appendComment("s", { role: "human", body: "Miss" });
    const sessions = stubSessions(prompts);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const started = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const recorded = submission(started);
    const conversationId = requireConversation(recorded);
    const later = new Date(Date.parse(recorded.at) + 1000).toISOString();
    writeIssue("fix-kept", {
      kind: "task",
      title: "Keep",
      partOf: "s",
      status: "todo",
      order: 1,
      createdAt: later,
      updatedAt: later,
    });
    writeIssue("old-task", {
      kind: "task",
      title: "Old",
      partOf: "s",
      status: "todo",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    await appendThreadEvent("s", kept.id, {
      event: "linked",
      taskId: "fix-kept",
      by: { role: "issue-tracker-review-tasker" },
    });
    await appendThreadEvent("s", missed.id, {
      event: "linked",
      taskId: "old-task",
      by: { role: "issue-tracker-review-tasker" },
    });

    await classifyReviewTaskingRun(
      conversationId,
      { status: "finished" },
      stubSessions(prompts),
    );
    expect(prompts).toHaveLength(1);
    const incomplete = submission(readReviewView("p", REVIEW_ID));
    expect(incomplete).toMatchObject({
      status: "incomplete",
      taskIds: ["fix-kept"],
      round: 1,
      openThreadIds: [missed.id],
    });
    expect(incomplete).not.toHaveProperty("error");
    expect(listAgentRunsForIssue("s")[0]?.status).toBe("completed");

    const retried = await retryReviewSubmission(
      "p",
      REVIEW_ID,
      recorded.id,
      {},
      sessions,
    );
    expect(submission(retried).status).toBe("tasking");
    expect(prompts).toHaveLength(1);
    await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      retried,
      sessions,
      "retry",
    );
    expect(prompts[1]).toContain(`Threads: ${missed.id}`);
    expect(prompts[1]).not.toContain(kept.id);

    await appendThreadEvent("s", missed.id, {
      event: "linked",
      taskId: "fix-kept",
      by: { role: "issue-tracker-review-tasker" },
    });
    await classifyReviewTaskingRun(
      conversationId,
      { status: "error", errorMessage: "late" },
      stubSessions(prompts),
    );
    const done = submission(readReviewView("p", REVIEW_ID));
    expect(done).toMatchObject({
      status: "done",
      taskIds: ["fix-kept"],
      coordinatorResumed: true,
    });
    expect(done).not.toHaveProperty("error");
    expect(listAgentRunsForIssue("s")[0]?.status).toBe("completed");
    const { implementingResumePrompt, implementingSessionMessage } = await import(
      "./implementing-launch.js"
    );
    expect(prompts[2]).toBe(
      `${implementingSessionMessage("e")}\n\n${implementingResumePrompt()}`,
    );
    const { listConversations } = await import("./conversations.js");
    expect(
      listConversations()
        .filter((meta) => meta.channel === "implementing" && !meta.archived)
        .map((meta) => meta.issueId),
    ).toEqual(["e"]);
  });

  it("refuses retry unless the submission failed with unlinked threads", async () => {
    seed();
    const prompts: string[] = [];
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      classifyReviewTaskingRun,
      retryReviewSubmission,
      appendThreadEvent,
    } = await load();
    const rootComment = await appendComment("s", { role: "human", body: "Fix" });
    const sessions = stubSessions(prompts);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const started = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const recorded = submission(started);
    const conversationId = requireConversation(recorded);
    const later = new Date(Date.parse(recorded.at) + 1000).toISOString();
    writeIssue("fix-it", {
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
      conversationId,
      { status: "cancelled" },
      stubSessions(prompts),
    );
    await expect(
      retryReviewSubmission("p", REVIEW_ID, recorded.id, {}, sessions),
    ).rejects.toThrow(`submission "${recorded.id}" is done`);
    await expect(
      retryReviewSubmission("p", REVIEW_ID, recorded.id, { summary: "no" }, sessions),
    ).rejects.toThrow("retry body must be empty");
  });

  it("starts the coordinator on a project-level Story", async () => {
    seed({}, { partOf: "p" });
    const prompts: string[] = [];
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      classifyReviewTaskingRun,
      appendThreadEvent,
    } = await load();
    const rootComment = await appendComment("s", { role: "human", body: "Fix" });
    const sessions = stubSessions(prompts);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const started = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const recorded = submission(started);
    const conversationId = requireConversation(recorded);
    const later = new Date(Date.parse(recorded.at) + 1000).toISOString();
    writeIssue("fix-it", {
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
      conversationId,
      { status: "finished" },
      sessions,
    );
    const { implementingResumePrompt, implementingSessionMessage } = await import(
      "./implementing-launch.js"
    );
    expect(prompts[1]).toBe(
      `${implementingSessionMessage("s")}\n\n${implementingResumePrompt()}`,
    );
    expect(submission(readReviewView("p", REVIEW_ID)).coordinatorResumed).toBe(true);
    const { listConversations } = await import("./conversations.js");
    expect(
      listConversations()
        .filter((meta) => meta.channel === "implementing" && !meta.archived)
        .map((meta) => meta.issueId),
    ).toEqual(["s"]);
  });

  it("leaves the submission done when the coordinator cannot be started", async () => {
    seed();
    const {
      submitReview,
      launchRecordedSubmission,
      appendComment,
      classifyReviewTaskingRun,
      appendThreadEvent,
      readReviewView,
    } = await load();
    const rootComment = await appendComment("s", { role: "human", body: "Fix" });
    let calls = 0;
    const sessions = {
      getActiveRun: () => undefined,
      sendPrompt: async () => {
        calls += 1;
        if (calls > 1) {
          return {
            ok: false as const,
            cause: "never_started" as const,
            error: new Error("coordinator down") as never,
          };
        }
        return { ok: true as const, run: { id: "run-1" } as never };
      },
    } as unknown as AgentSessions;
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const started = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const recorded = submission(started);
    const conversationId = requireConversation(recorded);
    const later = new Date(Date.parse(recorded.at) + 1000).toISOString();
    writeIssue("fix-it", {
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
    await expect(
      classifyReviewTaskingRun(conversationId, { status: "finished" }, sessions),
    ).resolves.toBe(true);
    const done = submission(readReviewView("p", REVIEW_ID));
    expect(done.status).toBe("done");
    expect(done).not.toHaveProperty("coordinatorResumed");
  });

  it("finishes a failed submission when its last thread is resolved", async () => {
    seed();
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      appendThreadEvent,
    } = await load();
    const claimed = await appendComment("s", { role: "human", body: "Already sent" });
    const sessions = stubSessions([], "sdk down");
    const recordedView = await submitReview("p", REVIEW_ID, {});
    await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    expect(submission(readReviewView("p", REVIEW_ID))).toMatchObject({
      status: "failed",
      threadIds: [claimed.id],
    });
    await appendThreadEvent("s", claimed.id, {
      event: "resolved",
      by: { role: "human" },
    });
    const done = submission(readReviewView("p", REVIEW_ID));
    expect(done).toMatchObject({ id: recordedView.submissions[0]!.id, status: "done" });
    expect(done).not.toHaveProperty("error");
    await appendThreadEvent("s", claimed.id, {
      event: "unresolved",
      by: { role: "human" },
    });
    const again = await submitReview("p", REVIEW_ID, {});
    expect(again.submissions[0]).toMatchObject({ id: done.id, status: "done" });
    expect(again.submissions[1]).toMatchObject({
      status: "tasking",
      threadIds: [claimed.id],
    });
  });

  it("keeps an open thread on an incomplete submission after it is unresolved", async () => {
    seed();
    const prompts: string[] = [];
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      appendThreadEvent,
      classifyReviewTaskingRun,
      NO_READY_THREADS_ERROR,
    } = await load();
    const stayed = await appendComment("s", { role: "human", body: "Stays open" });
    const toggled = await appendComment("s", { role: "human", body: "Toggle" });
    const sessions = stubSessions(prompts);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const started = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    await classifyReviewTaskingRun(
      requireConversation(submission(started)),
      { status: "finished" },
      sessions,
    );
    const incomplete = submission(readReviewView("p", REVIEW_ID));
    expect(incomplete).toMatchObject({
      status: "incomplete",
      openThreadIds: [stayed.id, toggled.id],
    });

    await appendThreadEvent("s", toggled.id, {
      event: "resolved",
      by: { role: "human" },
    });
    expect(submission(readReviewView("p", REVIEW_ID))).toMatchObject({
      status: "incomplete",
      openThreadIds: [stayed.id],
    });
    await appendThreadEvent("s", toggled.id, {
      event: "unresolved",
      by: { role: "human" },
    });
    expect(submission(readReviewView("p", REVIEW_ID))).toMatchObject({
      status: "incomplete",
      openThreadIds: [stayed.id, toggled.id],
    });
    await expect(submitReview("p", REVIEW_ID, {})).rejects.toThrow(NO_READY_THREADS_ERROR);

    const later = new Date(Date.parse(incomplete.at) + 1000).toISOString();
    const task = (id: string, title: string, order: number) =>
      writeIssue(id, {
        kind: "task", title, partOf: "s", status: "todo", order, createdAt: later, updatedAt: later,
      });
    task("stay-task", "Stay", 1);
    task("toggle-task", "Toggle", 2);
    await appendThreadEvent("s", stayed.id, {
      event: "linked",
      taskId: "stay-task",
      by: { role: "human" },
    });
    expect(submission(readReviewView("p", REVIEW_ID))).toMatchObject({
      status: "incomplete",
      openThreadIds: [toggled.id],
    });
    await appendThreadEvent("s", toggled.id, {
      event: "linked",
      taskId: "toggle-task",
      by: { role: "human" },
    });
    expect(submission(readReviewView("p", REVIEW_ID))).toMatchObject({
      status: "done",
      taskIds: ["stay-task", "toggle-task"],
    });
  });

  it("retries only open unlinked threads and finishes when none remain", async () => {
    seed();
    const prompts: string[] = [];
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      appendThreadEvent,
      classifyReviewTaskingRun,
      retryReviewSubmission,
    } = await load();
    const resolved = await appendComment("s", { role: "human", body: "Resolved" });
    const open = await appendComment("s", { role: "human", body: "Still open" });
    const sessions = stubSessions(prompts);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const started = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const recorded = submission(started);
    await classifyReviewTaskingRun(
      requireConversation(recorded),
      { status: "finished" },
      sessions,
    );

    await appendThreadEvent("s", resolved.id, {
      event: "resolved",
      by: { role: "human" },
    });
    const retried = await retryReviewSubmission("p", REVIEW_ID, recorded.id, {}, sessions);
    expect(submission(retried).status).toBe("tasking");
    await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      retried,
      sessions,
      "retry",
    );
    expect(prompts[1]).toContain(`Threads: ${open.id}`);
    expect(prompts[1]).not.toContain(resolved.id);

    await appendThreadEvent("s", open.id, {
      event: "resolved",
      by: { role: "human" },
    });
    expect(submission(readReviewView("p", REVIEW_ID)).status).toBe("tasking");
    const promptsBefore = prompts.length;
    await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      retried,
      sessions,
      "retry",
    );
    expect(prompts).toHaveLength(promptsBefore);
    const done = submission(readReviewView("p", REVIEW_ID));
    expect(done).toMatchObject({ status: "done", taskIds: [] });
    expect(done).not.toHaveProperty("error");
    expect(done).not.toHaveProperty("coordinatorResumed");
    const legacyThread = await appendComment("s", { role: "human", body: "Legacy open" });
    const storedPath = join(reviewTaskingIssuesDir(), "p", "reviews", `${REVIEW_ID}.json`);
    const stored = JSON.parse(readFileSync(storedPath, "utf8"));
    stored.submissions = [{
      id: recorded.id,
      at: recorded.at,
      threadIds: [legacyThread.id],
      status: "failed",
      error: TASKING_INCOMPLETE_REASON,
      conversationId: recorded.conversationId,
    }];
    writeFileSync(storedPath, JSON.stringify(stored));
    const legacy = submission(readReviewView("p", REVIEW_ID));
    expect(legacy).toMatchObject({
      status: "incomplete",
      round: 1,
      openThreadIds: [legacyThread.id],
    });
    expect(legacy).not.toHaveProperty("error");
  });

  it("records an errored run as failed while a clean run with leftovers is incomplete", async () => {
    seed();
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      classifyReviewTaskingRun,
    } = await load();
    await appendComment("s", { role: "human", body: "Fix" });
    const sessions = stubSessions([]);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const started = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    await classifyReviewTaskingRun(
      requireConversation(submission(started)),
      { status: "error", errorMessage: "tasker exploded" },
      sessions,
    );
    expect(submission(readReviewView("p", REVIEW_ID))).toMatchObject({
      status: "failed",
      error: "tasker exploded",
      round: 1,
    });
  });

  it("carries a thread again after it is unresolved once its submission is done", async () => {
    seed();
    const prompts: string[] = [];
    const {
      submitReview,
      launchRecordedSubmission,
      readReviewView,
      appendComment,
      appendThreadEvent,
      classifyReviewTaskingRun,
    } = await load();
    const rootComment = await appendComment("s", { role: "human", body: "Fix" });
    const sessions = stubSessions(prompts);
    const recordedView = await submitReview("p", REVIEW_ID, {});
    const started = await launchRecorded(
      { launchRecordedSubmission, readReviewView },
      recordedView,
      sessions,
    );
    const recorded = submission(started);
    const later = new Date(Date.parse(recorded.at) + 1000).toISOString();
    writeIssue("fix-it", {
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
      requireConversation(recorded),
      { status: "finished" },
      sessions,
    );
    const done = submission(readReviewView("p", REVIEW_ID));
    expect(done.status).toBe("done");

    await appendThreadEvent("s", rootComment.id, {
      event: "resolved",
      by: { role: "human" },
    });
    writeIssue("fix-it", {
      kind: "task",
      title: "Fix",
      partOf: "s",
      status: "done",
      order: 1,
      createdAt: later,
      updatedAt: later,
    });
    const reopened = await appendThreadEvent("s", rootComment.id, {
      event: "unresolved",
      by: { role: "human" },
    });
    expect(reopened.thread).toMatchObject({ state: "open" });
    expect(reopened.thread.linkedTaskId).toBeUndefined();

    const again = await submitReview("p", REVIEW_ID, {});
    expect(again.submissions[0]).toMatchObject({ id: done.id, status: "done" });
    expect(again.submissions[1]).toMatchObject({
      status: "tasking",
      threadIds: [rootComment.id],
    });
  });
});

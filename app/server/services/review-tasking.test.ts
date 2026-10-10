import { describe, expect, it } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import type { ReviewSubmission } from "../schemas/review.js";
import {
  AT,
  REVIEW_ID,
  seedReviewTasking as seed,
  stubReviewTaskingSessions,
  useReviewTaskingStore,
  writeReviewTaskingIssue as writeIssue,
} from "./review-tasking.test-fixtures.js";

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
    const sessions = stubReviewTaskingSessions(prompts);

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
    expect(prompts[0]).not.toContain("Summary comment:");
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
    const sessions = stubReviewTaskingSessions(prompts);
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
      stubReviewTaskingSessions(prompts),
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
      stubReviewTaskingSessions(prompts),
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
});

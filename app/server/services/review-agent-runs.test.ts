import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  REVIEW_ID,
  seedReviewTasking as seed,
  useReviewTaskingStore,
  writeReviewSubmissions,
} from "./review-tasking.test-fixtures.js";

function useStore() {
  useReviewTaskingStore("issue-tracker-review-agent-runs-");
}

async function load() {
  const conversations = await import("./conversations.js");
  const runs = await import("./review-agent-runs.js");
  const tasking = await import("./review-tasking.js");
  const standards = await import("./review-standards.js");
  const researcher = await import("./researcher-runs.js");
  const comments = await import("./comment-append.js");
  const threads = await import("./thread-events.js");
  const live = await import("./run-live.js");
  const config = await import("../config.js");
  const index = await import("./conversation-meta-index.js");
  return {
    ...conversations,
    ...runs,
    ...tasking,
    ...standards,
    ...researcher,
    ...comments,
    ...threads,
    ...live,
    ...config,
    resetConversationMetaIndexForTests: index.resetConversationMetaIndexForTests,
  };
}

function stamp(
  conversationsDir: string,
  id: string,
  createdAt: string,
  updatedAt: string,
): void {
  const path = join(conversationsDir, id, "meta.json");
  const meta = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...meta, createdAt, updatedAt }));
}

describe("review agent runs", () => {
  useStore();

  it("lists each top-level review run oldest first, and omits sessions that are not records", async () => {
    seed();
    const {
      createConversation,
      appendComment,
      appendThreadEvent,
      appendErrorEvent,
      writeRunLiveMarker,
      listReviewAgentRuns,
      conversationsDir,
      resetConversationMetaIndexForTests,
      REVIEW_TASKER_ROLE,
      STANDARDS_ASSESSOR_ROLE,
      REVIEW_QUESTION_ROLE,
    } = await load();

    const assessor = await createConversation({
      title: "Assessor",
      projectId: "p",
      model: "composer-2.5",
      issueId: REVIEW_ID,
      channel: "review",
      role: STANDARDS_ASSESSOR_ROLE,
    });
    const doneTasker = await createConversation({
      title: "Tasker round 1",
      projectId: "p",
      model: "composer-2.5",
      issueId: REVIEW_ID,
      channel: "review",
      role: REVIEW_TASKER_ROLE,
    });
    const runningTasker = await createConversation({
      title: "Tasker round 2",
      projectId: "p",
      model: "composer-2.5",
      issueId: REVIEW_ID,
      channel: "review",
      role: REVIEW_TASKER_ROLE,
    });
    const researcher = await createConversation({
      title: "Researcher",
      projectId: "p",
      model: "composer-2.5",
      issueId: REVIEW_ID,
      channel: "review",
      role: REVIEW_QUESTION_ROLE,
    });
    const later = await createConversation({
      title: "Later role",
      projectId: "p",
      model: "composer-2.5",
      issueId: REVIEW_ID,
      channel: "review",
      role: "issue-tracker-review-later",
    });
    await createConversation({
      title: "No role",
      projectId: "p",
      model: "composer-2.5",
      issueId: REVIEW_ID,
      channel: "review",
    });
    await createConversation({
      title: "Unlinked tasker",
      projectId: "p",
      model: "composer-2.5",
      issueId: REVIEW_ID,
      channel: "review",
      role: REVIEW_TASKER_ROLE,
    });
    await createConversation({
      title: "Coordinator",
      projectId: "p",
      model: "composer-2.5",
      issueId: "e",
      channel: "implementing",
      role: "issue-tracker-implementor",
    });

    const question = await appendComment(REVIEW_ID, {
      role: "human",
      kind: "question",
      body: "Should expired session tokens return 401?\nOr redirect?",
    });
    await appendThreadEvent(REVIEW_ID, question.id, {
      event: "researcher-session",
      conversationId: researcher.id,
      by: { role: "agent" },
    });
    await appendErrorEvent(later.id, "the later run failed");
    writeRunLiveMarker(runningTasker.id);

    writeReviewSubmissions([
      {
        id: "sub-1",
        at: "2026-10-12T09:00:00.000Z",
        threadIds: ["thread-1"],
        status: "done",
        taskIds: ["task-1"],
        conversationId: doneTasker.id,
        summaryCommentId: "summary-1",
        standards: {
          status: "ready",
          conversationId: assessor.id,
          doc: { type: "attachment", name: "coding-standards.md" },
          proposals: [],
        },
      },
      {
        id: "sub-2",
        at: "2026-10-14T16:00:00.000Z",
        threadIds: ["thread-2"],
        status: "tasking",
        conversationId: runningTasker.id,
      },
    ]);

    stamp(conversationsDir, assessor.id, "2026-10-12T09:15:00.000Z", "2026-10-12T09:19:12.000Z");
    stamp(conversationsDir, doneTasker.id, "2026-10-12T10:00:00.000Z", "2026-10-12T10:02:06.000Z");
    stamp(conversationsDir, researcher.id, "2026-10-14T11:02:00.000Z", "2026-10-14T11:03:48.000Z");
    stamp(conversationsDir, later.id, "2026-10-14T12:00:00.000Z", "2026-10-14T12:01:00.000Z");
    stamp(conversationsDir, runningTasker.id, "2026-10-14T16:40:00.000Z", "2026-10-14T16:40:00.000Z");
    resetConversationMetaIndexForTests();

    const runs = listReviewAgentRuns("p", REVIEW_ID);

    expect(runs.map((run) => run.conversationId)).toEqual([
      assessor.id,
      doneTasker.id,
      researcher.id,
      later.id,
      runningTasker.id,
    ]);
    expect(runs[0]).toMatchObject({
      role: STANDARDS_ASSESSOR_ROLE,
      model: "composer-2.5",
      status: "completed",
      startedAt: "2026-10-12T09:15:00.000Z",
      endedAt: "2026-10-12T09:19:12.000Z",
      round: 1,
      submittedAt: "2026-10-12T09:00:00.000Z",
      submissionId: "sub-1",
    });
    expect(runs[0]).not.toHaveProperty("submittedEntry");
    expect(runs[1]).toMatchObject({
      role: REVIEW_TASKER_ROLE,
      status: "completed",
      round: 1,
      submissionId: "sub-1",
      submittedEntry: true,
      endedAt: "2026-10-12T10:02:06.000Z",
    });
    expect(runs[2]).toMatchObject({
      role: REVIEW_QUESTION_ROLE,
      status: "completed",
      threadId: question.id,
      questionExcerpt: "Should expired session tokens return 401?",
      endedAt: "2026-10-14T11:03:48.000Z",
    });
    expect(runs[2]).not.toHaveProperty("round");
    expect(runs[3]).toMatchObject({
      role: "issue-tracker-review-later",
      status: "error",
      endedAt: "2026-10-14T12:01:00.000Z",
    });
    expect(runs[4]).toMatchObject({
      role: REVIEW_TASKER_ROLE,
      status: "running",
      round: 2,
      submittedAt: "2026-10-14T16:00:00.000Z",
      submissionId: "sub-2",
      submittedEntry: false,
    });
    expect(runs[4]).not.toHaveProperty("endedAt");
  });
});

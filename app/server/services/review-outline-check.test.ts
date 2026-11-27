import { describe, expect, it } from "vitest";
import type { ReviewSubmission } from "../schemas/review.js";
import type { AgentSessions } from "./agent-sessions.js";
import {
  onlySubmission,
  OUTLINE_ID,
  REVIEW_ID,
  seedOutlinedStory,
  seedReviewTasking,
  stubReviewTaskingSessions,
  useReviewTaskingStore,
  writeReviewTaskingIssue,
} from "./review-tasking.test-fixtures.js";

async function load() {
  const tasking = await import("./review-tasking.js");
  const check = await import("./review-outline-check.js");
  const issues = await import("./issues.js");
  const threads = await import("./thread-events.js");
  const reviews = await import("./reviews.js");
  const submit = await import("./review-submit.js");
  const drafts = await import("./outline-draft.js");
  const draftStore = await import("./outline-draft-store.js");
  return {
    ...tasking,
    ...check,
    ...issues,
    ...threads,
    ...reviews,
    ...submit,
    ...drafts,
    ...draftStore,
  };
}

type Api = Awaited<ReturnType<typeof load>>;

function checkConversation(submission: ReviewSubmission): string {
  const id = submission.outlineCheck?.conversationId;
  if (!id) throw new Error("expected an outline check conversation");
  return id;
}

/** Submit one thread on the outlined Story and start its check. */
async function submitAndCheck(api: Api, sessions: AgentSessions) {
  const thread = await api.appendComment(REVIEW_ID, { role: "human", body: "Rename it" });
  const recorded = onlySubmission(await api.submitReview("p", REVIEW_ID, {}));
  await api.launchRecordedSubmission("p", REVIEW_ID, recorded.id, "start", sessions);
  const started = onlySubmission(api.readReviewView("p", REVIEW_ID));
  return { threadId: thread.id, submissionId: recorded.id, conversationId: checkConversation(started) };
}

function current(api: Api): ReviewSubmission {
  return onlySubmission(api.readReviewView("p", REVIEW_ID));
}

describe("review outline check", () => {
  useReviewTaskingStore("issue-tracker-outline-check-");

  it("waits at the gate, and Yes tasks at the new version then reconciles that Story", async () => {
    seedReviewTasking();
    seedOutlinedStory();
    const prompts: string[] = [];
    const sessions = stubReviewTaskingSessions(prompts);
    const api = await load();
    const { threadId, submissionId, conversationId } = await submitAndCheck(api, sessions);

    await api.setOutlineDraft(OUTLINE_ID, "amended\n");
    expect(api.readOutlineDraft(OUTLINE_ID)).toEqual({
      body: "amended\n",
      review: REVIEW_ID,
      submission: submissionId,
    });
    await expect(
      api.recordOutlineCheckVerdict(REVIEW_ID, submissionId, "proposed"),
    ).resolves.toMatchObject({ status: "waiting" });
    await api.classifyReviewTaskingRun(conversationId, { status: "finished" }, sessions);
    expect(current(api)).toMatchObject({
      status: "tasking",
      outlineCheck: { status: "waiting" },
    });
    expect(prompts).toHaveLength(1);

    await expect(
      api.recordOutlineCheckVerdict(REVIEW_ID, submissionId, "yes"),
    ).resolves.toMatchObject({ status: "settled", version: 2, amended: true });
    expect(api.readOutlineOrThrow(OUTLINE_ID).bodyVersion).toBe(2);
    expect(api.readOutlineDraft(OUTLINE_ID)).toBeUndefined();

    await api.classifyReviewTaskingRun(conversationId, { status: "finished" }, sessions);
    expect(prompts[1]).toContain(`Outline: ${OUTLINE_ID}\nVersion: 2`);
    const taskerConversation = current(api).conversationId!;

    const later = new Date(Date.parse(current(api).at) + 1000).toISOString();
    writeReviewTaskingIssue("fix-name", {
      kind: "task",
      title: "Rename",
      partOf: "s",
      status: "todo",
      order: 1,
      createdAt: later,
      updatedAt: later,
    });
    await api.appendThreadEvent(REVIEW_ID, threadId, {
      event: "linked",
      taskId: "fix-name",
      by: { role: "issue-tracker-review-tasker" },
    });
    await api.classifyReviewTaskingRun(taskerConversation, { status: "finished" }, sessions);

    expect(current(api)).toMatchObject({ status: "done", taskIds: ["fix-name"] });
    expect(current(api).coordinatorResumed).toBeUndefined();
    const reconciler = prompts.find((prompt) => prompt.includes("_issue-tracker-reconciler"));
    expect(reconciler).toContain(`Outline: \`${OUTLINE_ID}\`. Version: \`2\`.`);
    expect(reconciler).toContain("Root: `e`.");
    expect(reconciler).toContain("Story: `s`.");
    expect(prompts.some((prompt) => prompt.includes("Covered by"))).toBe(false);
    expect(prompts.some((prompt) => prompt.includes("Mode: `reconcile`"))).toBe(false);
    expect(prompts.some((prompt) => prompt.includes("issue-tracker-plan-polish"))).toBe(false);

    const reconcilerConversationId = current(api).reconcilerConversationId;
    expect(reconcilerConversationId).toEqual(expect.any(String));
    await api.resumeCoordinatorAfterReconciler(reconcilerConversationId!, sessions);
    expect(current(api).coordinatorResumed).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("issue-tracker-plan-polish"))).toBe(false);
  });
});

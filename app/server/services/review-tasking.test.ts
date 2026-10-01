import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessions } from "./agent-sessions.js";
import type { ReviewSubmission } from "../schemas/review.js";

const AT = "2026-07-09T14:00:00.000Z";
const REVIEW_ID = "11111111-1111-4111-8111-111111111111";

let root: string;
let issuesDir: string;

function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(issuesDir, id), { recursive: true });
  writeFileSync(
    join(issuesDir, id, "issue.json"),
    JSON.stringify({ id, ...body }),
  );
}

function seed(
  story: Record<string, unknown> = {},
  parent: { partOf: string } = { partOf: "e" },
): void {
  writeIssue("p", {
    kind: "project",
    title: "P",
    workspace: root,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
  });
  if (parent.partOf === "e") {
    writeIssue("e", {
      kind: "epic",
      title: "E",
      partOf: "p",
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
  }
  writeIssue("s", {
    kind: "story",
    title: "S",
    partOf: parent.partOf,
    order: 0,
    createdAt: AT,
    updatedAt: AT,
    ...story,
  });
  mkdirSync(join(issuesDir, "p", "reviews"), { recursive: true });
  writeFileSync(
    join(issuesDir, "p", "reviews", `${REVIEW_ID}.json`),
    `${JSON.stringify({
      id: REVIEW_ID,
      projectId: "p",
      target: { kind: "story", storyId: "s" },
      status: "open",
      postMortem: false,
      createdAt: AT,
      updatedAt: AT,
      marks: { all: {}, commits: {} },
    })}\n`,
  );
}

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
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-review-tasking-"));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

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
      join(issuesDir, "s", "issue.json"),
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
    writeFileSync(join(issuesDir, "s", "comments.jsonl"), "");
    await expect(submitReview("p", REVIEW_ID, { summary: "   " })).rejects.toThrow(
      NO_READY_THREADS_ERROR,
    );
    expect(readFileSync(join(issuesDir, "s", "comments.jsonl"), "utf8")).toBe("");
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
      TASKING_INCOMPLETE_REASON,
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
    const failed = submission(readReviewView("p", REVIEW_ID));
    expect(failed).toMatchObject({
      status: "failed",
      error: TASKING_INCOMPLETE_REASON,
      taskIds: ["fix-kept"],
    });
    expect(listAgentRunsForIssue("s")[0]?.status).toBe("error");

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
    });
    expect(done).not.toHaveProperty("error");
    expect(listAgentRunsForIssue("s")[0]?.status).toBe("completed");
    const factual = `Review ${REVIEW_ID} appended Tasks fix-kept to Story s.`;
    const { implementingSessionMessage } = await import("./implementing-launch.js");
    expect(prompts[2]).toBe(`${implementingSessionMessage("e")}\n\n${factual}`);
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
    const factual = `Review ${REVIEW_ID} appended Tasks fix-it to Story s.`;
    const { implementingSessionMessage } = await import("./implementing-launch.js");
    expect(prompts[1]).toBe(`${implementingSessionMessage("s")}\n\n${factual}`);
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
    expect(submission(readReviewView("p", REVIEW_ID)).status).toBe("done");
  });
});

describe("review submission routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "issue-tracker-review-tasking-http-"));
    issuesDir = join(root, "issues");
    mkdirSync(issuesDir, { recursive: true });
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", issuesDir);
    vi.stubEnv("ISSUE_TRACKER_STORE_READ_ONLY", "");
    seed();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    rmSync(root, { recursive: true, force: true });
  });

  it("mounts submit and refuses when nothing is ready", async () => {
    const { createApp } = await import("../app.js");
    const { NO_READY_THREADS_ERROR } = await import("./review-tasking.js");
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP listen address");
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(
      `${baseUrl}/api/projects/p/reviews/${REVIEW_ID}/submissions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "validation",
      error: NO_READY_THREADS_ERROR,
    });
  });

  it("responds with a tasking submission before the tasker starts", async () => {
    let started = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sessions = {
      getActiveRun: () => undefined,
      sendPrompt: async () => {
        started = true;
        await gate;
        return { ok: true as const, run: { id: "run-1" } as never };
      },
    } as unknown as AgentSessions;
    const { appendComment } = await import("./issues.js");
    const { createApp } = await import("../app.js");
    const comment = await appendComment("s", { role: "human", body: "Fix it" });
    const app = createApp(sessions);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP listen address");
    baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await fetch(
        `${baseUrl}/api/projects/p/reviews/${REVIEW_ID}/submissions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary: "Ship it" }),
        },
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        submissions: { status: string; threadIds: string[]; conversationId?: string }[];
      };
      expect(body.submissions[0]).toMatchObject({
        status: "tasking",
        threadIds: [comment.id],
      });
      expect(body.submissions[0]?.conversationId).toBeUndefined();
      await vi.waitFor(() => expect(started).toBe(true));
    } finally {
      release();
    }
  });
});

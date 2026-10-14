import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import type { ReviewSubmission } from "../schemas/review.js";
import {
  AT,
  REVIEW_ID,
  seedReviewTasking,
  stubReviewTaskingSessions,
  useReviewTaskingStore,
  writeReviewSubmissions,
  writeReviewTaskingIssue as writeIssue,
} from "./review-tasking.test-fixtures.js";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "tester@example.com",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "tester@example.com",
};

function workspace(): string {
  return dirname(process.env.ISSUES_DIR!);
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspace(),
    encoding: "utf8",
    env: gitEnv,
  });
}

function attachCodingStandards(ref: { type: "attachment"; name: string } | { type: "workspace"; path: string }): void {
  const issuesDir = process.env.ISSUES_DIR!;
  if (ref.type === "attachment") {
    const dir = join(issuesDir, "p", "attachments");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ref.name), "# Coding Standards\n\n## Implementation\n\nBe clear.\n");
  } else {
    writeFileSync(join(workspace(), ref.path), "# Coding Standards\n\n## Implementation\n\nBe clear.\n");
  }
  const projectPath = join(issuesDir, "p", "issue.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as Record<string, unknown>;
  project.supportingDocs = { codingStandards: ref };
  writeFileSync(projectPath, JSON.stringify(project));
}

function pointReviewAtWorkspace(): void {
  const path = join(process.env.ISSUES_DIR!, REVIEW_ID, "issue.json");
  const review = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  review.worktreePath = workspace();
  writeFileSync(path, JSON.stringify(review));
}

function commitSha(): string {
  git(["init", "-b", "main"]);
  writeFileSync(join(workspace(), "auth-guard.ts"), "export const guard = true;\n");
  git(["add", "auth-guard.ts"]);
  git(["commit", "-m", "guard"]);
  return git(["rev-parse", "HEAD"]).trim();
}

function submission(view: { submissions: ReviewSubmission[] }): ReviewSubmission {
  return view.submissions[0]!;
}

async function load() {
  const standards = await import("./review-standards.js");
  const submit = await import("./review-submit.js");
  const issues = await import("./issues.js");
  const reviews = await import("./reviews.js");
  const runs = await import("./agent-runs.js");
  const cwd = await import("./agent-sessions.js");
  const cli = await import("../../cli-program.js");
  const conversations = await import("./conversations.js");
  const roles = await import("./role-bodies.js");
  return {
    ...standards,
    ...submit,
    ...issues,
    ...reviews,
    ...runs,
    ...cwd,
    ...cli,
    ...conversations,
    ...roles,
  };
}

describe("standards assessment at submit", () => {
  useReviewTaskingStore("issue-tracker-review-standards-");

  it("records a snapshotted doc and starts the assessor beside the tasker", async () => {
    seedReviewTasking();
    const sha = commitSha();
    attachCodingStandards({ type: "attachment", name: "coding-standards.md" });
    pointReviewAtWorkspace();
    writeIssue("t", {
      kind: "task",
      title: "Guard",
      partOf: "s",
      commits: [sha],
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    const prompts: string[] = [];
    const {
      submitReview,
      appendComment,
      launchSubmitAgents,
      listAgentRunsForIssue,
      standardsAssessorDelegationId,
      listAgentRunEvents,
      STANDARDS_ASSESSOR_ROLE,
    } = await load();
    const anchored = await appendComment(REVIEW_ID, {
      role: "human",
      body: "Reject fork PRs here.",
      anchor: { path: "auth-guard.ts", side: "new", line: 1, commitSha: sha },
    });
    const sessions = stubReviewTaskingSessions(prompts);
    const recorded = await submitReview("p", REVIEW_ID, {
      destination: "story",
      summary: "Address the guard.",
      assessStandards: true,
    });
    expect(submission(recorded)).toMatchObject({
      status: "tasking",
      standards: {
        status: "assessing",
        doc: { type: "attachment", name: "coding-standards.md" },
        proposals: [],
      },
    });
    expect(submission(recorded).standards).not.toHaveProperty("conversationId");

    await launchSubmitAgents("p", REVIEW_ID, recorded, sessions);
    expect(prompts).toHaveLength(2);
    const assessor = prompts.find((prompt) => prompt.includes("standards assessor"));
    const tasker = prompts.find((prompt) => prompt.includes("issue-tracker-review-tasker"));
    expect(tasker).toBeTruthy();
    expect(assessor).toContain(`Review: ${REVIEW_ID}`);
    expect(assessor).toContain(`Submission: ${submission(recorded).id}`);
    expect(assessor).toContain(`Threads: ${anchored.id}`);
    expect(assessor).toContain("Summary:\nAddress the guard.");
    expect(assessor).toContain("Coding standards: attachment coding-standards.md");
    expect(assessor).toContain("coding-standards.md");
    expect(assessor).toContain(`Task: t — Guard`);
    expect(assessor).toContain("Story: s — S");
    expect(assessor).toContain("Story diff: git diff main...");
    expect(assessor).toContain(`Commit diff: git show ${sha}`);
    expect(assessor).toContain(`Workspace: ${workspace()}`);

    const { readReviewView } = await load();
    const started = submission(readReviewView("p", REVIEW_ID));
    expect(started.standards?.status).toBe("assessing");
    expect(started.standards?.conversationId).toBeTruthy();
    const roles = listAgentRunsForIssue(REVIEW_ID).map((run) => run.role);
    expect(roles).toContain(STANDARDS_ASSESSOR_ROLE);
    expect(roles).toContain("issue-tracker-review-tasker");
    expect(
      listAgentRunEvents(
        REVIEW_ID,
        standardsAssessorDelegationId(started.standards!.conversationId!),
      ),
    ).toEqual([]);
  });
});

describe("standards proposal decisions and edits", () => {
  useReviewTaskingStore("issue-tracker-review-standards-proposal-");

  const proposal = (id: string, before: string, after: string) => ({
    id,
    section: "Implementation",
    before,
    after,
    rationale: "Feedback flagged it.",
    threadIds: ["th-1"],
  });

  function seedAssessment(status: string): void {
    seedReviewTasking();
    writeReviewSubmissions([
      {
        id: "sub-1",
        at: AT,
        status: "done",
        taskIds: [],
        threadIds: ["th-1"],
        standards: {
          status,
          doc: { type: "attachment", name: "coding-standards.md" },
          proposals: [
            proposal("rewrite", "Be clear.", "Be clear and brief."),
            proposal("delete", "Use globals.", ""),
          ],
        },
      },
    ]);
  }

  async function proposals() {
    const { readReviewView } = await load();
    return submission(readReviewView("p", REVIEW_ID)).standards!.proposals;
  }

  it("records a decision and an edit independently, and null clears each", async () => {
    seedAssessment("ready");
    const { setStandardsProposal } = await load();

    setStandardsProposal("p", REVIEW_ID, "sub-1", "rewrite", { decision: "accepted" });
    setStandardsProposal("p", REVIEW_ID, "sub-1", "rewrite", {
      editedAfter: "Be clear, brief, and exact.",
    });
    expect((await proposals())[0]).toMatchObject({
      decision: "accepted",
      editedAfter: "Be clear, brief, and exact.",
      after: "Be clear and brief.",
    });

    setStandardsProposal("p", REVIEW_ID, "sub-1", "rewrite", { decision: null });
    expect((await proposals())[0]).not.toHaveProperty("decision");
    expect((await proposals())[0]?.editedAfter).toBe("Be clear, brief, and exact.");

    setStandardsProposal("p", REVIEW_ID, "sub-1", "rewrite", {
      decision: "rejected",
      editedAfter: null,
    });
    expect((await proposals())[0]).toMatchObject({ decision: "rejected" });
    expect((await proposals())[0]).not.toHaveProperty("editedAfter");
    expect((await proposals())[1]).not.toHaveProperty("decision");
  });
});

describe("submitting a decided standards group", () => {
  useReviewTaskingStore("issue-tracker-review-standards-submit-");

  const DOC = { type: "attachment", name: "coding-standards.md" } as const;

  const proposal = (
    id: string,
    decision: "accepted" | "rejected",
    extra: Record<string, string> = {},
  ) => ({
    id,
    section: "Implementation",
    before: "Be clear.",
    after: `Be clear (${id}).`,
    rationale: "Feedback flagged it.",
    threadIds: ["th-1"],
    decision,
    ...extra,
  });

  async function seedReady(proposals: ReturnType<typeof proposal>[]): Promise<string> {
    seedReviewTasking();
    attachCodingStandards(DOC);
    const { createConversation, STANDARDS_ASSESSOR_ROLE, loadRoleModelPin } = await load();
    const meta = await createConversation({
      title: "Coding standards assessment",
      projectId: "p",
      model: loadRoleModelPin(STANDARDS_ASSESSOR_ROLE),
      issueId: REVIEW_ID,
      channel: "review",
      role: STANDARDS_ASSESSOR_ROLE,
      message: "assess",
    });
    writeReviewSubmissions([
      {
        id: "sub-1",
        at: AT,
        status: "done",
        taskIds: [],
        threadIds: ["th-1"],
        standards: { status: "ready", conversationId: meta.id, doc: DOC, proposals },
      },
    ]);
    return meta.id;
  }

  async function standards() {
    const { readReviewView } = await load();
    return submission(readReviewView("p", REVIEW_ID)).standards!;
  }

  it("resumes the assessor with accepted proposals and lands on applied when it reports", async () => {
    const conversationId = await seedReady([
      proposal("kept", "accepted", { editedAfter: "Be clear and exact." }),
      proposal("plain", "accepted"),
      proposal("dropped", "rejected"),
    ]);
    const { submitStandardsGroup, launchStandardsRun, markStandardsApplied } = await load();
    const sent: { id: string; prompt: string }[] = [];
    const sessions = {
      getActiveRun: () => undefined,
      sendPrompt: async (id: string, options: { prompt: string }) => {
        sent.push({ id, prompt: options.prompt });
        return { ok: true as const, run: { id: "run-apply" } as never };
      },
    } as unknown as Parameters<typeof launchStandardsRun>[3];

    submitStandardsGroup("p", REVIEW_ID, "sub-1", {}, sessions);
    expect((await standards()).status).toBe("applying");
    await launchStandardsRun("p", REVIEW_ID, "sub-1", sessions);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.id).toBe(conversationId);
    const prompt = sent[0]!.prompt;
    expect(prompt).toContain("Mode: apply");
    expect(prompt).toContain(`Review: ${REVIEW_ID}`);
    expect(prompt).toContain("Submission: sub-1");
    expect(prompt).toContain("Project: p");
    expect(prompt).toContain("Coding standards: attachment coding-standards.md");
    expect(prompt).toContain('"after": "Be clear and exact."');
    expect(prompt).toContain('"after": "Be clear (plain)."');
    expect(prompt).not.toContain("dropped");

    markStandardsApplied(REVIEW_ID, "sub-1");
    expect(await standards()).toMatchObject({ status: "applied", conversationId });
    expect(() => markStandardsApplied(REVIEW_ID, "sub-1")).toThrow(
      "standards assessment is applied",
    );
  });
});

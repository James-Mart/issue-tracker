import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import type { ReviewSubmission } from "../schemas/review.js";
import type { AgentSessions } from "./agent-sessions.js";
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

const STANDARDS_DOC = { type: "attachment", name: "coding-standards.md" } as const;

type SeededProposal = {
  id: string;
  section: string;
  before: string;
  after: string;
  rationale: string;
  threadIds: string[];
  decision?: "accepted" | "rejected" | "iterate";
  feedback?: string;
  editedAfter?: string;
};

const seededProposal = (id: string, extra: Partial<SeededProposal> = {}): SeededProposal => ({
  id,
  section: "Implementation",
  before: "Be clear.",
  after: `Be clear (${id}).`,
  rationale: "Feedback flagged it.",
  threadIds: ["th-1"],
  ...extra,
});

async function seedReadyRound(proposals: SeededProposal[]): Promise<string> {
  seedReviewTasking();
  attachCodingStandards(STANDARDS_DOC);
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
      standards: { status: "ready", conversationId: meta.id, doc: STANDARDS_DOC, proposals },
    },
  ]);
  return meta.id;
}

async function readStandards() {
  const { readReviewView } = await load();
  return submission(readReviewView("p", REVIEW_ID)).standards!;
}

function recordingSessions() {
  const sent: { id: string; prompt: string }[] = [];
  const sessions = {
    getActiveRun: () => undefined,
    sendPrompt: async (id: string, options: { prompt: string }) => {
      sent.push({ id, prompt: options.prompt });
      return { ok: true as const, run: { id: "run-standards" } as never };
    },
  } as unknown as AgentSessions;
  return { sent, sessions };
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

  it("resumes the assessor with accepted proposals and lands on applied when it reports", async () => {
    const conversationId = await seedReadyRound([
      seededProposal("kept", { decision: "accepted", editedAfter: "Be clear and exact." }),
      seededProposal("plain", { decision: "accepted" }),
      seededProposal("dropped", { decision: "rejected" }),
    ]);
    const { submitStandardsGroup, launchStandardsRun, markStandardsApplied } = await load();
    const { sent, sessions } = recordingSessions();

    submitStandardsGroup("p", REVIEW_ID, "sub-1", {}, sessions);
    expect((await readStandards()).status).toBe("applying");
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
    expect(await readStandards()).toMatchObject({ status: "applied", conversationId });
    expect(() => markStandardsApplied(REVIEW_ID, "sub-1")).toThrow(
      "standards assessment is applied",
    );
  });

  it("sends the section-end line for an accepted pure addition", async () => {
    await seedReadyRound([
      seededProposal("add", {
        decision: "accepted",
        before: "",
        after: "Name the boundary.",
        editedAfter: "Name a function for its intent.",
      }),
      seededProposal("kept", { decision: "accepted" }),
    ]);
    const { submitStandardsGroup, launchStandardsRun } = await load();
    const { sent, sessions } = recordingSessions();

    submitStandardsGroup("p", REVIEW_ID, "sub-1", {}, sessions);
    await launchStandardsRun("p", REVIEW_ID, "sub-1", sessions);

    const prompt = sent[0]!.prompt;
    const accepted = JSON.parse(prompt.slice(prompt.indexOf("["))) as {
      id: string;
      section: string;
      before: string;
      after: string;
      line?: number;
    }[];
    expect(accepted).toEqual([
      {
        id: "add",
        section: "Implementation",
        before: "",
        after: "Name a function for its intent.",
        line: 6,
      },
      {
        id: "kept",
        section: "Implementation",
        before: "Be clear.",
        after: "Be clear (kept).",
      },
    ]);
  });
});

describe("iterating a standards round", () => {
  useReviewTaskingStore("issue-tracker-review-standards-iterate-");

  const text = ({ section, before, after, rationale, threadIds }: SeededProposal) => ({
    section,
    before,
    after,
    rationale,
    threadIds,
  });

  const sentAs = (seeded: SeededProposal, extra: Record<string, string>) => ({
    id: seeded.id,
    ...text(seeded),
    ...extra,
  });

  function sentProposals(prompt: string): unknown[] {
    return JSON.parse(prompt.slice(prompt.lastIndexOf("Proposals:\n") + "Proposals:\n".length)) as unknown[];
  }

  it("resumes the assessor on Iterate marks and lands each outcome on the same round", async () => {
    const conversationId = await seedReadyRound([
      seededProposal("rev", {
        decision: "iterate",
        feedback: "  Mention PR descriptions.  ",
        editedAfter: "Be clear (rev), edited.",
      }),
      seededProposal("push", { decision: "iterate", feedback: "Prefer full words." }),
      seededProposal("wd", { decision: "iterate", feedback: "Cover async errors." }),
      seededProposal("kept", { decision: "accepted" }),
    ]);
    const {
      submitStandardsGroup,
      launchStandardsRun,
      recordStandardsIterate,
      setStandardsProposal,
    } = await load();
    const { sent, sessions } = recordingSessions();

    submitStandardsGroup("p", REVIEW_ID, "sub-1", {}, sessions);
    expect((await readStandards()).status).toBe("iterating");
    await launchStandardsRun("p", REVIEW_ID, "sub-1", sessions);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.id).toBe(conversationId);
    const prompt = sent[0]!.prompt;
    expect(prompt).toContain("Mode: iterate");
    expect(prompt).toContain(`Review: ${REVIEW_ID}`);
    expect(prompt).toContain("Submission: sub-1");
    expect(prompt).not.toContain("Mode: apply");
    expect(sentProposals(prompt)).toEqual([
      sentAs(seededProposal("rev"), {
        after: "Be clear (rev), edited.",
        decision: "iterate",
        feedback: "Mention PR descriptions.",
      }),
      sentAs(seededProposal("push"), { decision: "iterate", feedback: "Prefer full words." }),
      sentAs(seededProposal("wd"), { decision: "iterate", feedback: "Cover async errors." }),
      sentAs(seededProposal("kept"), { decision: "accepted" }),
    ]);

    recordStandardsIterate(REVIEW_ID, "sub-1", {
      outcomes: [
        {
          id: "rev",
          kind: "revise",
          proposal: { ...text(seededProposal("rev")), after: "Say what the PR changes." },
          reply: "Moved under Implementation.",
        },
        {
          id: "push",
          kind: "push-back",
          proposal: text(seededProposal("push")),
        },
        {
          id: "wd",
          kind: "withdraw",
          proposal: text(seededProposal("wd")),
          reply: "Covered by the verification doc.",
        },
      ],
      added: [{ ...text(seededProposal("new")), id: "new", reply: "Added for offline captures." }],
    });

    const after = (await load()).readReviewView("p", REVIEW_ID);
    expect(after.submissions).toHaveLength(1);
    const round = submission(after).standards!;
    expect(round.status).toBe("ready");
    expect(round.conversationId).toBe(conversationId);
    expect(round).not.toHaveProperty("error");
    expect(round.proposals).toEqual([
      {
        ...text(seededProposal("rev")),
        id: "rev",
        after: "Say what the PR changes.",
        sentFeedback: "Mention PR descriptions.",
        reply: "Moved under Implementation.",
      },
      { ...text(seededProposal("push")), id: "push", sentFeedback: "Prefer full words." },
      {
        ...text(seededProposal("wd")),
        id: "wd",
        sentFeedback: "Cover async errors.",
        reply: "Covered by the verification doc.",
        withdrawn: true,
      },
      { ...text(seededProposal("kept")), id: "kept", decision: "accepted" },
      { ...text(seededProposal("new")), id: "new", reply: "Added for offline captures." },
    ]);

    expect(() =>
      setStandardsProposal("p", REVIEW_ID, "sub-1", "wd", { decision: "accepted" }),
    ).toThrow('proposal "wd" was withdrawn');
    for (const id of ["rev", "new"]) {
      setStandardsProposal("p", REVIEW_ID, "sub-1", id, { decision: "accepted" });
    }
    setStandardsProposal("p", REVIEW_ID, "sub-1", "push", { decision: "rejected" });
    submitStandardsGroup("p", REVIEW_ID, "sub-1", {}, sessions);
    expect((await readStandards()).status).toBe("applying");
    await launchStandardsRun("p", REVIEW_ID, "sub-1", sessions);
    const apply = sent[1]!.prompt;
    expect(apply).toContain("Mode: apply");
    expect(apply).toContain('"id": "rev"');
    expect(apply).toContain('"id": "new"');
    expect(apply).not.toContain('"id": "wd"');
  });
});

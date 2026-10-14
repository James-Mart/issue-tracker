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
  return { ...standards, ...submit, ...issues, ...reviews, ...runs, ...cwd, ...cli };
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

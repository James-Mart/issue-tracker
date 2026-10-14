import { existsSync } from "fs";
import { z } from "zod";
import type { AgentRun, ConversationMeta, Issue } from "../schemas.js";
import { formatZodError } from "../schemas.js";
import type {
  ReviewRecordView,
  ReviewSubmission,
  StandardsAssessment,
} from "../schemas/review.js";
import { parseRetryReviewSubmissionBody } from "../schemas/review.js";
import { standardsProposalSchema } from "../schemas/review-state.js";
import type { AgentRunStatus } from "./agent-sdk.js";
import type { AgentSessions } from "./agent-sessions.js";
import { prepareStoryChange } from "./change.js";
import {
  createConversation,
  deleteConversation,
  listConversations,
  readConversationMeta,
  startConversationPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readAll, readComments, readIssueOrThrow, readReviewOrThrow } from "./issues.js";
import { presentSubmissions } from "./review-submission-threads.js";
import { launchRecordedSubmission, reviewOfConversation } from "./review-tasking.js";
import { liveReviewWorktreePath } from "./review-worktree.js";
import { readReviewView, updateStoredReview } from "./reviews.js";
import { isRunLive } from "./run-live.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";
import { resolveSupportingDocPath } from "./supporting-docs.js";

export const STANDARDS_ASSESSOR_ROLE = "issue-tracker-standards-assessor";

const STANDARDS_ASSESSOR_DELEGATION_PREFIX = "standards-assessor:";

const standardsSetProposalSchema = standardsProposalSchema
  .omit({ decision: true, editedAfter: true })
  .refine((proposal) => proposal.before.length > 0 || proposal.after.length > 0, {
    message: "a proposal needs before or after text",
  })
  .refine((proposal) => !/[\r\n]/.test(proposal.rationale), {
    message: "rationale is one line",
  });

const standardsSetFileSchema = z
  .object({
    proposals: z.array(standardsSetProposalSchema),
  })
  .strict();

type StandardsSetProposal = z.infer<typeof standardsSetProposalSchema>;

export type StandardsRunOutcome = {
  status: AgentRunStatus;
  errorMessage?: string;
};

/** Snapshotted coding-standards doc for an opt-in submit. Refuses when ineligible. */
export function standardsAssessmentForSubmit(
  projectId: string,
  reviewId: string,
): StandardsAssessment {
  const project = readIssueOrThrow(projectId);
  if (project.kind !== "project") {
    throw new IssueError("not_found", `unknown project "${projectId}"`);
  }
  const review = readReviewView(projectId, reviewId);
  if (!review.story) {
    throw new IssueError("validation", `review "${reviewId}" has no Story source`);
  }
  const ref = project.supportingDocs?.codingStandards;
  if (!ref) {
    throw new IssueError(
      "validation",
      `project "${projectId}" has no coding-standards doc`,
    );
  }
  return { status: "assessing", doc: ref, proposals: [] };
}

function standardsDocPath(
  projectId: string,
  doc: StandardsAssessment["doc"],
): string {
  const project = readIssueOrThrow(projectId);
  const workspace = project.kind === "project" ? project.workspace : undefined;
  const path = resolveSupportingDocPath(projectId, workspace, doc);
  if (!path || !existsSync(path)) {
    const label = doc.type === "attachment" ? doc.name : doc.path;
    throw new IssueError("validation", `coding-standards doc is missing: ${label}`);
  }
  return path;
}

function docLine(doc: StandardsAssessment["doc"]): string {
  return doc.type === "attachment"
    ? `Coding standards: attachment ${doc.name}`
    : `Coding standards: workspace ${doc.path}`;
}

function summaryLine(
  messages: readonly { id: string; body: string }[],
  summaryCommentId: string | undefined,
): string {
  if (!summaryCommentId) return "Summary: none";
  const body = messages.find((message) => message.id === summaryCommentId)?.body.trim();
  return body ? `Summary:\n${body}` : "Summary: none";
}

async function storyDiffLine(
  storyId: string,
  workspace: string,
  issues: Issue[],
): Promise<string> {
  const prepared = await prepareStoryChange(storyId, workspace, issues);
  // No merge base or no descendant commits: there is no range to show.
  // A git failure throws and the launch records assessFailed.
  if (prepared.state !== "ready") return "Story diff: none";
  return `Story diff: git diff ${prepared.range}`;
}

function tasksForSha(sha: string, issues: readonly Issue[]) {
  return issues.filter(
    (issue): issue is Extract<Issue, { kind: "task" }> =>
      issue.kind === "task" && issue.commits.includes(sha),
  );
}

async function commitBlocks(
  messages: readonly {
    id: string;
    anchor?: { commitSha?: string };
  }[],
  threadIds: readonly string[],
  workspace: string,
): Promise<string[]> {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const bySha = new Map<string, string[]>();
  for (const threadId of threadIds) {
    const sha = byId.get(threadId)?.anchor?.commitSha;
    if (!sha) continue;
    const ids = bySha.get(sha) ?? [];
    ids.push(threadId);
    bySha.set(sha, ids);
  }
  const issues = readAll().issues;
  const diffByStory = new Map<string, Promise<string>>();
  const blocks: string[] = [];
  for (const [sha, ids] of bySha) {
    const lines = [`Commit ${sha} (threads ${ids.join(", ")}):`];
    const tasks = tasksForSha(sha, issues);
    if (tasks.length === 0) {
      lines.push("Task: none");
    } else {
      for (const task of tasks) {
        const story = issues.find((issue) => issue.id === task.partOf);
        lines.push(`Task: ${task.id} — ${task.title}`);
        lines.push(
          story ? `Story: ${story.id} — ${story.title}` : `Story: ${task.partOf}`,
        );
        let diff = diffByStory.get(task.partOf);
        if (!diff) {
          diff = storyDiffLine(task.partOf, workspace, issues);
          diffByStory.set(task.partOf, diff);
        }
        lines.push(await diff);
      }
    }
    lines.push(`Commit diff: git show ${sha}`);
    blocks.push(lines.join("\n"));
  }
  return blocks;
}

async function assessmentPrompt(
  projectId: string,
  review: ReviewRecordView,
  submission: ReviewSubmission,
  standards: StandardsAssessment,
): Promise<string> {
  const workspace = liveReviewWorktreePath(readReviewOrThrow(review.id));
  const storyId = review.story;
  if (!storyId) {
    throw new IssueError("validation", `review "${review.id}" has no Story source`);
  }
  const messages = readComments(review.id).messages;
  const blocks = await commitBlocks(messages, submission.threadIds, workspace);
  return [
    loadRoleBody(STANDARDS_ASSESSOR_ROLE).trim(),
    "",
    `Review: ${review.id}`,
    `Submission: ${submission.id}`,
    `Story: ${storyId}`,
    `Threads: ${submission.threadIds.join(", ")}`,
    summaryLine(messages, submission.summaryCommentId),
    docLine(standards.doc),
    `Path: ${standardsDocPath(projectId, standards.doc)}`,
    `Workspace: ${workspace}`,
    ...blocks,
  ].join("\n");
}

function failureReason(outcome: StandardsRunOutcome): string {
  const message = outcome.errorMessage?.trim();
  if (message) return message;
  return `assessment run ${outcome.status}`;
}

/** Drop read-model fields so a view submission can be written back. */
function storedSubmission(submission: ReviewSubmission): ReviewSubmission {
  const { round: _round, openThreadIds: _openThreadIds, ...stored } =
    submission as ReviewSubmission & { round?: number; openThreadIds?: string[] };
  return stored;
}

function patchSubmission(
  projectId: string,
  reviewId: string,
  submissionId: string,
  patch: (stored: ReviewSubmission) => ReviewSubmission,
): ReviewRecordView {
  return updateStoredReview(projectId, reviewId, (current) => {
    const index = current.submissions.findIndex((item) => item.id === submissionId);
    if (index < 0) {
      throw new IssueError("not_found", `unknown submission "${submissionId}"`);
    }
    const submissions = current.submissions.slice();
    submissions[index] = storedSubmission(patch(current.submissions[index]!));
    return { ...current, updatedAt: new Date().toISOString(), submissions };
  });
}

async function markAssessFailed(
  projectId: string,
  reviewId: string,
  submissionId: string,
  message: string,
): Promise<void> {
  const reason = message.trim() || "standards assessment failed";
  patchSubmission(projectId, reviewId, submissionId, (stored) => {
    if (stored.standards?.status !== "assessing") return stored;
    return {
      ...stored,
      standards: { ...stored.standards, status: "assessFailed", error: reason },
    };
  });
}

/**
 * Start tasking and standards assessment together. Each launch returns when
 * its run has started. Neither waits on the other's run.
 */
export async function launchSubmitAgents(
  projectId: string,
  reviewId: string,
  view: { submissions: readonly ReviewSubmission[] },
  sessions: AgentSessions,
): Promise<void> {
  const tasking = view.submissions.find(
    (item) => item.status === "tasking" && !item.conversationId,
  );
  const assessing = view.submissions.filter((item) =>
    submissionNeedsStandardsLaunch(item),
  );
  await Promise.all([
    tasking
      ? launchRecordedSubmission(projectId, reviewId, tasking.id, "start", sessions)
      : Promise.resolve(),
    ...assessing.map((item) =>
      launchStandardsAssessment(projectId, reviewId, item.id, sessions),
    ),
  ]);
}

/**
 * Create the assessor conversation and start the run. A failure is stored on
 * the assessment. A conversation already recorded means this launch is done.
 */
export async function launchStandardsAssessment(
  projectId: string,
  reviewId: string,
  submissionId: string,
  sessions: AgentSessions,
): Promise<void> {
  const review = readReviewView(projectId, reviewId);
  const submission = review.submissions.find((item) => item.id === submissionId);
  const standards = submission?.standards;
  if (!submission || !standards || standards.status !== "assessing") return;
  // Already recorded: a second route fire must not start another assessor.
  if (standards.conversationId) return;

  try {
    const prompt = await assessmentPrompt(projectId, review, submission, standards);
    const model = loadRoleModelPin(STANDARDS_ASSESSOR_ROLE);
    const meta = await createConversation({
      title: "Coding standards assessment",
      projectId,
      model,
      issueId: reviewId,
      channel: "review",
      role: STANDARDS_ASSESSOR_ROLE,
      message: prompt,
    });
    try {
      const recorded = patchSubmission(projectId, reviewId, submissionId, (stored) => {
        const currentStandards = stored.standards;
        if (!currentStandards || currentStandards.status !== "assessing") return stored;
        if (currentStandards.conversationId) return stored;
        return {
          ...stored,
          standards: { ...currentStandards, conversationId: meta.id },
        };
      });
      const saved = recorded.submissions.find((item) => item.id === submissionId);
      if (saved?.standards?.conversationId !== meta.id) {
        await deleteConversation(meta.id);
        return;
      }
    } catch (err) {
      await deleteConversation(meta.id);
      throw err;
    }
    const started = await startConversationPrompt(
      meta.id,
      prompt,
      model,
      sessions,
      { persistPrompt: false },
    );
    if (!started.ok) {
      await markAssessFailed(projectId, reviewId, submissionId, started.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const latest =
      readReviewView(projectId, reviewId).submissions.find(
        (item) => item.id === submissionId,
      ) ?? submission;
    if (latest.standards?.status !== "assessing") return;
    try {
      await markAssessFailed(projectId, reviewId, submissionId, message);
    } catch (markErr) {
      console.error(
        `could not record standards assessment failure for submission ${submissionId}:`,
        markErr,
      );
    }
  }
}

/** An assessing submission with no conversation yet is ready to launch. */
export function submissionNeedsStandardsLaunch(
  submission: { standards?: StandardsAssessment } | undefined,
): boolean {
  const standards = submission?.standards;
  return standards?.status === "assessing" && !standards.conversationId;
}

function findAssessing(conversationId: string):
  | {
      projectId: string;
      review: ReviewRecordView;
      submission: ReviewSubmission;
    }
  | undefined {
  const meta = readConversationMeta(conversationId);
  const review = reviewOfConversation(meta, readAll().issues);
  if (!review) return undefined;
  const submission = review.submissions.find(
    (item) =>
      item.standards?.conversationId === conversationId &&
      item.standards.status === "assessing",
  );
  if (!submission) return undefined;
  return { projectId: meta.projectId, review, submission };
}

/** A run that ends while still assessing did not report proposals. */
export function classifyStandardsAssessmentRun(
  conversationId: string,
  outcome: StandardsRunOutcome,
): boolean {
  const found = findAssessing(conversationId);
  if (!found) return false;
  let saved = false;
  patchSubmission(found.projectId, found.review.id, found.submission.id, (stored) => {
    if (stored.standards?.status !== "assessing") return stored;
    if (stored.standards.conversationId !== conversationId) return stored;
    saved = true;
    return {
      ...stored,
      standards: {
        ...stored.standards,
        status: "assessFailed",
        error: failureReason(outcome),
      },
    };
  });
  return saved;
}

export function failStandardsAssessmentClassification(
  conversationId: string,
  message: string,
): boolean {
  const found = findAssessing(conversationId);
  if (!found) return false;
  const reason = message.trim() || "standards assessment classification failed";
  patchSubmission(found.projectId, found.review.id, found.submission.id, (stored) => {
    if (stored.standards?.status !== "assessing") return stored;
    return {
      ...stored,
      standards: { ...stored.standards, status: "assessFailed", error: reason },
    };
  });
  return true;
}

function proposalThreadError(
  proposal: StandardsSetProposal,
  allowed: ReadonlySet<string>,
): string | undefined {
  const unknown = proposal.threadIds.find((id) => !allowed.has(id));
  if (unknown) {
    return `proposal "${proposal.id}" names thread "${unknown}" outside the submission`;
  }
  return undefined;
}

/**
 * Record proposals for an assessing submission.
 * An empty list lands on `noGaps`; any proposal lands on `ready`.
 */
export function setReviewStandards(
  reviewId: string,
  submissionId: string,
  raw: unknown,
): "ready" | "noGaps" {
  const parsed = standardsSetFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid standards file"),
    );
  }
  const proposals = parsed.data.proposals;
  const ids = new Set<string>();
  for (const proposal of proposals) {
    if (ids.has(proposal.id)) {
      throw new IssueError("validation", `proposal id "${proposal.id}" is duplicated`);
    }
    ids.add(proposal.id);
  }
  const review = readReviewOrThrow(reviewId);
  const status = proposals.length === 0 ? "noGaps" : "ready";
  patchSubmission(review.partOf, reviewId, submissionId, (stored) => {
    const standards = stored.standards;
    if (!standards || standards.status !== "assessing") {
      throw new IssueError(
        "validation",
        `standards assessment is ${standards?.status ?? "absent"}`,
      );
    }
    const allowed = new Set(stored.threadIds);
    for (const proposal of proposals) {
      const threadError = proposalThreadError(proposal, allowed);
      if (threadError) throw new IssueError("validation", threadError);
    }
    return {
      ...stored,
      standards: {
        status,
        doc: standards.doc,
        proposals,
        ...(standards.conversationId
          ? { conversationId: standards.conversationId }
          : {}),
      },
    };
  });
  return status;
}

/** Fresh assessor run from `assessFailed`. The route starts it. */
export function retryStandardsAssessment(
  projectId: string,
  reviewId: string,
  submissionId: string,
  body: unknown,
  sessions: Pick<AgentSessions, "getActiveRun">,
): ReviewRecordView {
  const parsed = parseRetryReviewSubmissionBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  const review = readReviewView(projectId, reviewId);
  const submission = review.submissions.find((item) => item.id === submissionId);
  if (!submission) {
    throw new IssueError("not_found", `unknown submission "${submissionId}"`);
  }
  const standards = submission.standards;
  if (!standards || standards.status !== "assessFailed") {
    throw new IssueError(
      "validation",
      `standards assessment is ${standards?.status ?? "absent"}`,
    );
  }
  if (
    standards.conversationId &&
    sessions.getActiveRun(standards.conversationId)
  ) {
    throw new IssueError("conflict", "a standards assessment is already running");
  }
  return patchSubmission(projectId, reviewId, submissionId, (stored) => {
    const currentStandards = stored.standards;
    if (!currentStandards || currentStandards.status !== "assessFailed") {
      throw new IssueError(
        "validation",
        `standards assessment is ${currentStandards?.status ?? "absent"}`,
      );
    }
    return {
      ...stored,
      standards: {
        status: "assessing",
        doc: currentStandards.doc,
        proposals: [],
      },
    };
  });
}

export function standardsAssessorDelegationId(conversationId: string): string {
  return `${STANDARDS_ASSESSOR_DELEGATION_PREFIX}${conversationId}`;
}

export function conversationIdFromStandardsAssessorDelegation(
  delegationId: string,
): string | undefined {
  if (!delegationId.startsWith(STANDARDS_ASSESSOR_DELEGATION_PREFIX)) return undefined;
  const conversationId = delegationId.slice(STANDARDS_ASSESSOR_DELEGATION_PREFIX.length);
  return conversationId.length > 0 ? conversationId : undefined;
}

function agentRunStatus(
  live: boolean,
  status: StandardsAssessment["status"],
): AgentRun["status"] {
  if (live) return "running";
  if (status === "assessFailed" || status === "applyFailed") return "error";
  if (status === "assessing" || status === "applying") return "unknown";
  return "completed";
}

function assessorAgentRun(
  meta: ConversationMeta,
  issueId: string,
  standards: StandardsAssessment,
): AgentRun {
  const status = agentRunStatus(isRunLive(meta.id), standards.status);
  return {
    delegationId: standardsAssessorDelegationId(meta.id),
    agentId: meta.agentId ?? meta.id,
    role: STANDARDS_ASSESSOR_ROLE,
    model: meta.model,
    issueId,
    parentCallId: meta.id,
    conversationId: meta.id,
    startedAt: meta.createdAt,
    status,
    ...((status === "completed" || status === "error")
      ? { endedAt: meta.updatedAt }
      : {}),
    isResume: false,
  };
}

function assessorConversations(
  issueId: string,
  issues?: Issue[],
): { meta: ConversationMeta; standards: StandardsAssessment }[] {
  const graph = issues ?? readAll().issues;
  const review = graph.find((issue) => issue.id === issueId);
  if (review?.kind !== "review") return [];
  const submissions = presentSubmissions(review, graph);
  return listConversations().flatMap((meta) => {
    if (meta.issueId !== issueId || meta.channel !== "review") return [];
    if (meta.role !== STANDARDS_ASSESSOR_ROLE) return [];
    const submission = submissions.find(
      (item) => item.standards?.conversationId === meta.id,
    );
    return submission?.standards ? [{ meta, standards: submission.standards }] : [];
  });
}

export function standardsAssessorConversationIds(
  reviewId: string,
  issues?: Issue[],
): string[] {
  return assessorConversations(reviewId, issues).map(({ meta }) => meta.id);
}

export function standardsAssessorRunsForIssue(
  issueId: string,
  issues?: Issue[],
): AgentRun[] {
  return assessorConversations(issueId, issues).map(({ meta, standards }) =>
    assessorAgentRun(meta, issueId, standards),
  );
}

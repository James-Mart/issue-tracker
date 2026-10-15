import { existsSync, readFileSync } from "fs";
import type { AgentRun, ConversationMeta, Issue } from "../schemas.js";
import { formatZodError } from "../schemas.js";
import type {
  ReviewRecordView,
  ReviewSubmission,
  StandardsAssessment,
} from "../schemas/review.js";
import {
  parseEmptyBody,
  parseRetryReviewSubmissionBody,
  setStandardsProposalBodySchema,
} from "../schemas/review.js";
import {
  everyProposalDecided,
  proposalAfterText,
  WORKSPACE_STANDARDS_SUBMIT_REASON,
} from "../review-standards-status.js";
import { applyPureAddition } from "../standards-proposal-anchor.js";
import type { AgentRunStatus } from "./agent-sdk.js";
import type { AgentSessions } from "./agent-sessions.js";
import { prepareStoryChange } from "./change.js";
import { conversationExists } from "./conversation-ids.js";
import {
  createConversation,
  deleteConversation,
  listConversations,
  readConversationMeta,
  startConversationPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readAll, readComments, readIssueOrThrow, readReviewOrThrow } from "./issues.js";
import {
  iterateRequestProposals,
  mergeIterateReport,
  proposalThreadError,
  standardsSetFileSchema,
} from "./review-standards-proposals.js";
import { presentSubmissions } from "./review-submission-threads.js";
import { launchRecordedSubmission, reviewOfConversation } from "./review-tasking.js";
import { liveReviewWorktreePath } from "./review-worktree.js";
import { readReviewView, updateStoredReview } from "./reviews.js";
import { isRunLive } from "./run-live.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";
import { resolveSupportingDocPath } from "./supporting-docs.js";

export const STANDARDS_ASSESSOR_ROLE = "issue-tracker-standards-assessor";

const STANDARDS_ASSESSOR_DELEGATION_PREFIX = "standards-assessor:";

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

/**
 * The status a run works in, and where it lands when it ends without its verb.
 * A failed iterate pass leaves the round `ready` with its pre-pass proposals.
 */
type StandardsRunPhase = "assessing" | "iterating" | "applying";

const PHASE_FAILED = {
  assessing: "assessFailed",
  iterating: "ready",
  applying: "applyFailed",
} as const satisfies Record<StandardsRunPhase, StandardsAssessment["status"]>;

const PHASE_LABEL: Record<StandardsRunPhase, string> = {
  assessing: "standards assessment",
  iterating: "standards revision",
  applying: "standards apply",
};

function failureReason(outcome: StandardsRunOutcome, phase: StandardsRunPhase): string {
  const message = outcome.errorMessage?.trim();
  if (message) return message;
  return `${PHASE_LABEL[phase]} run ${outcome.status}`;
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

/** Land a run's phase on its failed status. A submission past that phase stays as it is. */
function markPhaseFailed(
  projectId: string,
  reviewId: string,
  submissionId: string,
  phase: StandardsRunPhase,
  message: string,
): boolean {
  const reason = message.trim() || `${PHASE_LABEL[phase]} failed`;
  let saved = false;
  patchSubmission(projectId, reviewId, submissionId, (stored) => {
    if (stored.standards?.status !== phase) return stored;
    saved = true;
    return {
      ...stored,
      standards: { ...stored.standards, status: PHASE_FAILED[phase], error: reason },
    };
  });
  return saved;
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
async function launchStandardsAssessment(
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

  const launch = { projectId, reviewId, submissionId, phase: "assessing" } as const;
  await runPhaseLaunch(launch, async () =>
    startNewAssessor(
      launch,
      undefined,
      await assessmentPrompt(projectId, review, submission, standards),
      sessions,
    ),
  );
}

type AssessorLaunch = {
  projectId: string;
  reviewId: string;
  submissionId: string;
  phase: StandardsRunPhase;
};

type PromptStart = Awaited<ReturnType<typeof startConversationPrompt>>;

/** A start that does not run, or throws, fails the launch's phase. */
async function runPhaseLaunch(
  { projectId, reviewId, submissionId, phase }: AssessorLaunch,
  start: () => Promise<PromptStart | undefined>,
): Promise<void> {
  try {
    const started = await start();
    if (started && !started.ok) {
      markPhaseFailed(projectId, reviewId, submissionId, phase, started.message);
    }
  } catch (err) {
    recordLaunchFailure(projectId, reviewId, submissionId, phase, err);
  }
}

/**
 * Open an assessor conversation on `prompt` and record it in place of
 * `priorConversationId`, then start the run. Returns `undefined` without
 * starting when the submission has left `phase` or another launch recorded
 * its conversation first.
 */
async function startNewAssessor(
  { projectId, reviewId, submissionId, phase }: AssessorLaunch,
  priorConversationId: string | undefined,
  prompt: string,
  sessions: AgentSessions,
): Promise<PromptStart | undefined> {
  const meta = await createConversation({
    title: "Coding standards assessment",
    projectId,
    model: loadRoleModelPin(STANDARDS_ASSESSOR_ROLE),
    issueId: reviewId,
    channel: "review",
    role: STANDARDS_ASSESSOR_ROLE,
    message: prompt,
  });
  try {
    const recorded = patchSubmission(projectId, reviewId, submissionId, (stored) => {
      const currentStandards = stored.standards;
      if (!currentStandards || currentStandards.status !== phase) return stored;
      if (currentStandards.conversationId !== priorConversationId) return stored;
      return {
        ...stored,
        standards: { ...currentStandards, conversationId: meta.id },
      };
    });
    const saved = recorded.submissions.find((item) => item.id === submissionId);
    if (saved?.standards?.conversationId !== meta.id) {
      await deleteConversation(meta.id);
      return undefined;
    }
  } catch (err) {
    await deleteConversation(meta.id);
    throw err;
  }
  return startConversationPrompt(meta.id, prompt, sessions, { persistPrompt: false });
}

/** The HTTP response has been sent, so a failed write is logged rather than thrown. */
function recordLaunchFailure(
  projectId: string,
  reviewId: string,
  submissionId: string,
  phase: StandardsRunPhase,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  try {
    markPhaseFailed(projectId, reviewId, submissionId, phase, message);
  } catch (markErr) {
    console.error(
      `could not record ${PHASE_LABEL[phase]} failure for submission ${submissionId}:`,
      markErr,
    );
  }
}

/** An assessing submission with no conversation yet is ready to launch. */
function submissionNeedsStandardsLaunch(
  submission: { standards?: StandardsAssessment } | undefined,
): boolean {
  const standards = submission?.standards;
  return standards?.status === "assessing" && !standards.conversationId;
}

function isRunPhase(status: StandardsAssessment["status"]): status is StandardsRunPhase {
  return status === "assessing" || status === "iterating" || status === "applying";
}

function findRunning(conversationId: string):
  | {
      projectId: string;
      reviewId: string;
      submissionId: string;
      phase: StandardsRunPhase;
    }
  | undefined {
  const meta = readConversationMeta(conversationId);
  const review = reviewOfConversation(meta, readAll().issues);
  if (!review) return undefined;
  for (const submission of review.submissions) {
    const standards = submission.standards;
    if (standards?.conversationId !== conversationId) continue;
    if (!isRunPhase(standards.status)) continue;
    return {
      projectId: meta.projectId,
      reviewId: review.id,
      submissionId: submission.id,
      phase: standards.status,
    };
  }
  return undefined;
}

/**
 * A run that ends while still assessing did not report proposals; one that
 * ends while still iterating did not report its outcomes; one that ends
 * while still applying did not report the apply.
 */
export function classifyStandardsAssessmentRun(
  conversationId: string,
  outcome: StandardsRunOutcome,
): boolean {
  const found = findRunning(conversationId);
  if (!found) return false;
  return markPhaseFailed(
    found.projectId,
    found.reviewId,
    found.submissionId,
    found.phase,
    failureReason(outcome, found.phase),
  );
}

export function failStandardsAssessmentClassification(
  conversationId: string,
  message: string,
): boolean {
  const found = findRunning(conversationId);
  if (!found) return false;
  return markPhaseFailed(
    found.projectId,
    found.reviewId,
    found.submissionId,
    found.phase,
    message.trim() || `${PHASE_LABEL[found.phase]} classification failed`,
  );
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

/**
 * Record a human decision, inline edit, or Iterate feedback draft on one
 * proposal of a `ready` assessment. Withdrawn proposals take none.
 */
export function setStandardsProposal(
  projectId: string,
  reviewId: string,
  submissionId: string,
  proposalId: string,
  body: unknown,
): ReviewRecordView {
  const parsed = setStandardsProposalBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid standards proposal body"),
    );
  }
  const { decision, editedAfter, feedback } = parsed.data;
  return patchSubmission(projectId, reviewId, submissionId, (stored) => {
    const standards = stored.standards;
    if (!standards || standards.status !== "ready") {
      throw new IssueError(
        "validation",
        `standards assessment is ${standards?.status ?? "absent"}`,
      );
    }
    const index = standards.proposals.findIndex((item) => item.id === proposalId);
    if (index < 0) {
      throw new IssueError("not_found", `unknown proposal "${proposalId}"`);
    }
    const {
      decision: priorDecision,
      editedAfter: priorEdit,
      feedback: priorFeedback,
      ...proposal
    } = standards.proposals[index]!;
    if (proposal.withdrawn) {
      throw new IssueError("validation", `proposal "${proposalId}" was withdrawn`);
    }
    if (typeof editedAfter === "string" && proposal.after.length === 0) {
      throw new IssueError(
        "validation",
        `proposal "${proposalId}" removes text and has no added text to edit`,
      );
    }
    const nextDecision = decision === undefined ? priorDecision : decision;
    const nextEdit = editedAfter === undefined ? priorEdit : editedAfter;
    const nextFeedback = feedback === undefined ? priorFeedback : feedback;
    const proposals = standards.proposals.slice();
    proposals[index] = {
      ...proposal,
      ...(nextDecision ? { decision: nextDecision } : {}),
      ...(nextEdit ? { editedAfter: nextEdit } : {}),
      ...(nextFeedback ? { feedback: nextFeedback } : {}),
    };
    return { ...stored, standards: { ...standards, proposals } };
  });
}

function assertAssessorIdle(
  standards: StandardsAssessment,
  sessions: Pick<AgentSessions, "getActiveRun">,
): void {
  if (standards.conversationId && sessions.getActiveRun(standards.conversationId)) {
    throw new IssueError("conflict", "the standards assessor is still running");
  }
}

/**
 * Submit a `ready` group once every proposal is decided. Any Iterate mark
 * moves it to `iterating` and nothing is applied. Otherwise any accepted
 * proposal moves it to `applying`; either way the route resumes the
 * assessor. An all-rejected group lands on `applied` with no doc change.
 */
export function submitStandardsGroup(
  projectId: string,
  reviewId: string,
  submissionId: string,
  body: unknown,
  sessions: Pick<AgentSessions, "getActiveRun">,
): ReviewRecordView {
  const parsed = parseEmptyBody(body, "submit body must be empty");
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  return patchSubmission(projectId, reviewId, submissionId, (stored) => {
    const standards = stored.standards;
    if (!standards || standards.status !== "ready") {
      throw new IssueError(
        "validation",
        `standards assessment is ${standards?.status ?? "absent"}`,
      );
    }
    if (standards.doc.type === "workspace") {
      throw new IssueError("validation", WORKSPACE_STANDARDS_SUBMIT_REASON);
    }
    if (!everyProposalDecided(standards.proposals)) {
      throw new IssueError("validation", "every proposal needs a decision");
    }
    const someMarked = (decision: "accepted" | "iterate") =>
      standards.proposals.some((proposal) => proposal.decision === decision);
    const status = someMarked("iterate")
      ? "iterating"
      : someMarked("accepted")
        ? "applying"
        : "applied";
    if (status !== "applied") assertAssessorIdle(standards, sessions);
    const { error: _error, ...rest } = standards;
    return { ...stored, standards: { ...rest, status } };
  });
}

function acceptedProposalForApply(
  proposal: StandardsAssessment["proposals"][number],
  fileText: string,
): {
  id: string;
  section: string;
  before: string;
  after: string;
  line?: number;
} {
  const after = proposalAfterText(proposal);
  return {
    id: proposal.id,
    section: proposal.section,
    before: proposal.before,
    after,
    ...(proposal.before.length === 0
      ? { line: applyPureAddition({ section: proposal.section, after, fileText }).line }
      : {}),
  };
}

function applyPrompt(
  projectId: string,
  reviewId: string,
  submissionId: string,
  standards: StandardsAssessment,
): string {
  const path = standardsDocPath(projectId, standards.doc);
  const fileText = readFileSync(path, "utf8");
  const accepted = standards.proposals
    .filter((proposal) => proposal.decision === "accepted")
    .map((proposal) => acceptedProposalForApply(proposal, fileText));
  return [
    ...assessorPromptHeader("apply", projectId, reviewId, submissionId, standards.doc, path),
    "Accepted proposals:",
    JSON.stringify(accepted, null, 2),
  ].join("\n");
}

function assessorPromptHeader(
  mode: "apply" | "iterate",
  projectId: string,
  reviewId: string,
  submissionId: string,
  doc: StandardsAssessment["doc"],
  path: string,
): string[] {
  return [
    `Mode: ${mode}`,
    `Review: ${reviewId}`,
    `Submission: ${submissionId}`,
    `Project: ${projectId}`,
    docLine(doc),
    `Path: ${path}`,
  ];
}

/**
 * Resume the assessor conversation with the accepted proposals of an
 * `applying` group. A failure is stored on the assessment as `applyFailed`.
 */
async function launchStandardsApply(
  projectId: string,
  reviewId: string,
  submissionId: string,
  standards: StandardsAssessment,
  sessions: AgentSessions,
): Promise<void> {
  await runPhaseLaunch({ projectId, reviewId, submissionId, phase: "applying" }, () => {
    const conversationId = standards.conversationId;
    if (!conversationId) {
      throw new Error(`submission "${submissionId}" has no assessor conversation`);
    }
    return startConversationPrompt(
      conversationId,
      applyPrompt(projectId, reviewId, submissionId, standards),
      sessions,
    );
  });
}

function iteratePrompt(
  projectId: string,
  reviewId: string,
  submissionId: string,
  standards: StandardsAssessment,
): string {
  const path = standardsDocPath(projectId, standards.doc);
  return [
    ...assessorPromptHeader("iterate", projectId, reviewId, submissionId, standards.doc, path),
    "Proposals:",
    JSON.stringify(iterateRequestProposals(standards.proposals), null, 2),
  ].join("\n");
}

/** A recorded assessor conversation that can still take a prompt. */
function resumableAssessor(conversationId: string | undefined): conversationId is string {
  if (!conversationId || !conversationExists(conversationId)) return false;
  return !readConversationMeta(conversationId).archived;
}

/**
 * Send an `iterating` group's marks to its assessor: the same conversation
 * when it can still take a prompt, else a new assessor that also gets the
 * first-pass inputs. A failure returns the group to `ready` with `error`.
 */
async function launchStandardsIterate(
  projectId: string,
  review: ReviewRecordView,
  submission: ReviewSubmission,
  standards: StandardsAssessment,
  sessions: AgentSessions,
): Promise<void> {
  const reviewId = review.id;
  const submissionId = submission.id;
  const launch = { projectId, reviewId, submissionId, phase: "iterating" } as const;
  await runPhaseLaunch(launch, async () => {
    const prompt = iteratePrompt(projectId, reviewId, submissionId, standards);
    const conversationId = standards.conversationId;
    if (resumableAssessor(conversationId)) {
      return startConversationPrompt(conversationId, prompt, sessions);
    }
    const firstPass = await assessmentPrompt(projectId, review, submission, standards);
    return startNewAssessor(
      launch,
      conversationId,
      [firstPass, "", prompt].join("\n"),
      sessions,
    );
  });
}

/**
 * Handler for `issue review standards iterated`. Lands an iterate pass's
 * outcomes and added proposals and returns the group to `ready`. A refused
 * report fails the pass: the group returns to `ready` with its pre-pass
 * proposals and the refusal as `error`, and the refusal is thrown.
 */
export function recordStandardsIterate(
  reviewId: string,
  submissionId: string,
  raw: unknown,
): void {
  const review = readReviewOrThrow(reviewId);
  let refused: IssueError | undefined;
  patchSubmission(review.partOf, reviewId, submissionId, (stored) => {
    const standards = stored.standards;
    if (!standards || standards.status !== "iterating") {
      throw new IssueError(
        "validation",
        `standards assessment is ${standards?.status ?? "absent"}`,
      );
    }
    try {
      const proposals = mergeIterateReport(standards.proposals, stored.threadIds, raw);
      const { error: _error, ...rest } = standards;
      return { ...stored, standards: { ...rest, status: "ready", proposals } };
    } catch (err) {
      if (!(err instanceof IssueError)) throw err;
      refused = err;
      return { ...stored, standards: { ...standards, status: "ready", error: err.message } };
    }
  });
  if (refused) throw refused;
}

/**
 * Start the run a submit or retry left the assessment waiting on: a fresh
 * assessor while `assessing` with no conversation, the assessor on the
 * Iterate marks while `iterating`, or a resumed apply while `applying`. Any
 * other status starts nothing.
 */
export async function launchStandardsRun(
  projectId: string,
  reviewId: string,
  submissionId: string,
  sessions: AgentSessions,
): Promise<void> {
  const review = readReviewView(projectId, reviewId);
  const submission = review.submissions.find((item) => item.id === submissionId);
  const standards = submission?.standards;
  if (submissionNeedsStandardsLaunch(submission)) {
    await launchStandardsAssessment(projectId, reviewId, submissionId, sessions);
  } else if (submission && standards?.status === "iterating") {
    await launchStandardsIterate(projectId, review, submission, standards, sessions);
  } else if (standards?.status === "applying") {
    await launchStandardsApply(projectId, reviewId, submissionId, standards, sessions);
  }
}

/** Handler for `issue review standards applied`, reported once the accepted edits are on the attachment. */
export function markStandardsApplied(reviewId: string, submissionId: string): void {
  const review = readReviewOrThrow(reviewId);
  patchSubmission(review.partOf, reviewId, submissionId, (stored) => {
    const standards = stored.standards;
    if (!standards || standards.status !== "applying") {
      throw new IssueError(
        "validation",
        `standards assessment is ${standards?.status ?? "absent"}`,
      );
    }
    return { ...stored, standards: { ...standards, status: "applied" } };
  });
}

/**
 * Re-run the failed phase: a fresh assessor run from `assessFailed`, or a
 * resumed apply from `applyFailed`. The route starts it.
 */
export function retryStandardsAssessment(
  projectId: string,
  reviewId: string,
  submissionId: string,
  body: unknown,
  sessions: Pick<AgentSessions, "getActiveRun">,
): ReviewRecordView {
  const parsed = parseRetryReviewSubmissionBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  return patchSubmission(projectId, reviewId, submissionId, (stored) => {
    const standards = stored.standards;
    if (standards?.status === "applyFailed") {
      assertAssessorIdle(standards, sessions);
      const { error: _error, ...rest } = standards;
      return { ...stored, standards: { ...rest, status: "applying" } };
    }
    if (standards?.status === "assessFailed") {
      assertAssessorIdle(standards, sessions);
      return {
        ...stored,
        standards: { status: "assessing", doc: standards.doc, proposals: [] },
      };
    }
    throw new IssueError(
      "validation",
      `standards assessment is ${standards?.status ?? "absent"}`,
    );
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

export function standardsAgentRunStatus(
  live: boolean,
  status: StandardsAssessment["status"],
): AgentRun["status"] {
  if (live) return "running";
  if (status === "assessFailed" || status === "applyFailed") return "error";
  if (isRunPhase(status)) return "unknown";
  return "completed";
}

function assessorAgentRun(
  meta: ConversationMeta,
  issueId: string,
  standards: StandardsAssessment,
): AgentRun {
  const status = standardsAgentRunStatus(isRunLive(meta.id), standards.status);
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

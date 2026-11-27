import type { Issue } from "../schemas.js";
import type {
  OutlineCheck,
  ReviewRecordView,
  ReviewSubmission,
} from "../schemas/review.js";
import {
  startIdleConversationTurn,
  type ConversationMessageSessions,
} from "./conversation-message.js";
import {
  deleteConversation,
  readConversationMeta,
  startFirstPrompt,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readAll, readOutlineOrThrow, readReviewOrThrow, serialize } from "./issues.js";
import { readOutlineDraft, writeOutlineDraft } from "./outline-draft-store.js";
import {
  removePendingDraftForNotNow,
  rewriteOutlineDraftBody,
  saveOutlineDraftVersion,
} from "./outline-draft.js";
import { createOutlinePlanningSession } from "./outline-planning-session.js";
import { patchStoredSubmission, readReviewView } from "./reviews.js";

export const OUTLINE_CHECK_VERDICTS = ["unchanged", "proposed", "yes", "not-now"] as const;

export type OutlineCheckVerdict = (typeof OUTLINE_CHECK_VERDICTS)[number];

/** Sent when a retry re-enters a check conversation that already exists. */
export const OUTLINE_CHECK_RESUME_PROMPT =
  "The outline check stopped before it settled. Continue it from where it stopped.";

type CheckedSubmission = ReviewSubmission & { outlineCheck: OutlineCheck };

/** The check a new submission starts with when its Story is linked to an outline. */
export function initialOutlineCheck(story: Issue): OutlineCheck | undefined {
  if (story.kind !== "story" || !story.sourceOutline) return undefined;
  return { outline: story.sourceOutline.outline, status: "checking" };
}

/** True while the check still holds the tasker back. */
export function outlineCheckPending(
  submission: ReviewSubmission,
): submission is CheckedSubmission {
  return submission.outlineCheck !== undefined && submission.outlineCheck.status !== "settled";
}

/** Prompt lines naming the outline version the tasker stamps its Tasks with. */
export function outlineCheckTaskerLines(submission: ReviewSubmission): string[] {
  const check = submission.outlineCheck;
  if (check?.version === undefined) return [];
  return [`Outline: ${check.outline}`, `Version: ${check.version}`];
}

function patchOutlineCheck(
  projectId: string,
  reviewId: string,
  submissionId: string,
  patch: (check: OutlineCheck) => OutlineCheck,
): void {
  patchStoredSubmission(projectId, reviewId, submissionId, (stored) => ({
    ...stored,
    outlineCheck: patch(checkInProgress(stored)),
  }));
}

function checkInProgress(submission: ReviewSubmission): OutlineCheck {
  if (submission.status !== "tasking" || !submission.outlineCheck) {
    throw new IssueError(
      "validation",
      `submission "${submission.id}" has no outline check in progress`,
    );
  }
  return submission.outlineCheck;
}

/**
 * Re-enter the recorded check conversation on retry, or open a new check
 * session on the outline's decomposition channel. A new session refuses an
 * outline that already holds a pending draft, since the check writes that draft.
 */
export async function launchOutlineCheck(
  projectId: string,
  review: ReviewRecordView,
  storyId: string,
  submission: CheckedSubmission,
  threadIds: readonly string[],
  sessions: ConversationMessageSessions,
): Promise<void> {
  const check = submission.outlineCheck;
  if (check.conversationId && !readConversationMeta(check.conversationId).archived) {
    const resumed = await startIdleConversationTurn(
      check.conversationId,
      OUTLINE_CHECK_RESUME_PROMPT,
      sessions,
    );
    if (!resumed.ok) throw new Error(resumed.message);
    return;
  }
  if (readOutlineDraft(check.outline) !== undefined) {
    throw new IssueError(
      "conflict",
      `outline "${check.outline}" already has a pending draft — approve or discard it, then retry`,
    );
  }
  const { meta, firstPrompt } = await createOutlinePlanningSession(
    {
      outlineId: check.outline,
      role: "check",
      reviewId: review.id,
      submissionId: submission.id,
      storyId,
      threadIds,
    },
    sessions,
  );
  try {
    patchOutlineCheck(projectId, review.id, submission.id, (current) => ({
      ...current,
      conversationId: meta.id,
    }));
  } catch (err) {
    firstPrompt.claim.release();
    await deleteConversation(meta.id);
    throw err;
  }
  const started = await startFirstPrompt(meta.id, firstPrompt, sessions);
  if (!started.ok) throw new Error(started.message);
}

/** The tasking submission whose outline check runs in `conversationId`. */
export function findOutlineCheckRun(conversationId: string):
  | { projectId: string; review: ReviewRecordView; submission: CheckedSubmission }
  | undefined {
  const meta = readConversationMeta(conversationId);
  if (meta.outlineRole !== "check" || meta.issueId === undefined) return undefined;
  const issues = readAll().issues;
  for (const issue of issues) {
    if (issue.kind !== "review" || issue.partOf !== meta.projectId) continue;
    const submission = issue.submissions.find(
      (item): item is CheckedSubmission =>
        item.status === "tasking" &&
        item.outlineCheck?.outline === meta.issueId &&
        item.outlineCheck?.conversationId === conversationId,
    );
    if (!submission) continue;
    return {
      projectId: issue.partOf,
      review: readReviewView(issue.partOf, issue.id, issues),
      submission,
    };
  }
  return undefined;
}

function requirePhase(
  check: OutlineCheck,
  allowed: readonly OutlineCheck["status"][],
  verdict: OutlineCheckVerdict,
): void {
  if (!allowed.includes(check.status)) {
    throw new IssueError(
      "validation",
      `outline check is ${check.status}; "${verdict}" needs ${allowed.join(" or ")}`,
    );
  }
}

function requireCheck(
  reviewId: string,
  submissionId: string,
): { projectId: string; check: OutlineCheck } {
  const review = readReviewOrThrow(reviewId);
  const submission = review.submissions.find((item) => item.id === submissionId);
  if (!submission) {
    throw new IssueError("not_found", `unknown submission "${submissionId}"`);
  }
  return { projectId: review.partOf, check: checkInProgress(submission) };
}

/**
 * Record what the outline check decided. `unchanged` and `not-now` settle at
 * the current version; `yes` saves the pending draft as the next version and
 * settles there; `proposed` waits at the outline gate. The tasker starts when
 * the check's run ends settled.
 */
export async function recordOutlineCheckVerdict(
  reviewId: string,
  submissionId: string,
  verdict: OutlineCheckVerdict,
): Promise<OutlineCheck> {
  const { projectId, check } = requireCheck(reviewId, submissionId);
  const outlineId = check.outline;
  let next: OutlineCheck;
  if (verdict === "unchanged") {
    requirePhase(check, ["checking"], verdict);
    if (readOutlineDraft(outlineId) !== undefined) {
      throw new IssueError(
        "validation",
        `outline "${outlineId}" has a pending draft — record "proposed", or discard the draft`,
      );
    }
    next = settledAtVersion(check, readOutlineOrThrow(outlineId).bodyVersion);
  } else if (verdict === "proposed") {
    requirePhase(check, ["checking", "waiting"], verdict);
    if (readOutlineDraft(outlineId) === undefined) {
      throw new IssueError("validation", `outline "${outlineId}" has no pending draft`);
    }
    next = { ...check, status: "waiting" };
  } else if (verdict === "yes") {
    requirePhase(check, ["waiting"], verdict);
    next = { ...settledAtVersion(check, await saveOutlineDraftVersion(outlineId)), amended: true };
  } else {
    requirePhase(check, ["waiting"], verdict);
    await removePendingDraftForNotNow(outlineId);
    next = settledAtVersion(check, readOutlineOrThrow(outlineId).bodyVersion);
  }
  patchOutlineCheck(projectId, reviewId, submissionId, (current) => {
    if (current.status !== check.status) {
      throw new IssueError("conflict", "outline check changed while the verdict was recorded");
    }
    return next;
  });
  return next;
}

/** Stdout line for an outline-check verdict (`settled <version>` once settled). */
export function formatOutlineCheckVerdict(check: OutlineCheck): string {
  return check.status === "settled" ? `settled ${check.version}` : check.status;
}

/**
 * The outline-check gate's write. Opens a draft owned by the single outline
 * check in `checking` for this outline, or rewrites the open draft's text.
 */
export function setOutlineDraft(id: string, body: string): Promise<void> {
  return serialize(() => {
    readOutlineOrThrow(id);
    if (readOutlineDraft(id)) {
      rewriteOutlineDraftBody(id, body);
      return;
    }
    const owner = soleCheckingOwner(id);
    writeOutlineDraft(id, { body, review: owner.review, submission: owner.submission });
  });
}

/** The one outline check in `checking` that may open this outline's draft. */
function soleCheckingOwner(outlineId: string): { review: string; submission: string } {
  let owner: { review: string; submission: string } | undefined;
  for (const issue of readAll().issues) {
    if (issue.kind !== "review") continue;
    for (const submission of issue.submissions) {
      const check = submission.outlineCheck;
      if (
        submission.status !== "tasking" ||
        check?.outline !== outlineId ||
        check.status !== "checking"
      ) {
        continue;
      }
      if (owner) {
        throw new IssueError(
          "conflict",
          `outline "${outlineId}" has more than one outline check that can open a draft`,
        );
      }
      owner = { review: issue.id, submission: submission.id };
    }
  }
  if (!owner) {
    throw new IssueError(
      "validation",
      `outline "${outlineId}" has no outline check that can open a draft`,
    );
  }
  return owner;
}

/**
 * Settle the pending draft's outline-check gate. `yes` and `not-now` are the
 * same write as `issue review outline-check`.
 */
export async function settleOutlineDraft(
  outlineId: string,
  verdict: "yes" | "not-now",
): Promise<OutlineCheck> {
  readOutlineOrThrow(outlineId);
  const draft = readOutlineDraft(outlineId);
  if (!draft) {
    throw new IssueError("validation", `outline "${outlineId}" has no pending draft`);
  }
  return recordOutlineCheckVerdict(draft.review, draft.submission, verdict);
}

function settledAtVersion(check: OutlineCheck, version: number): OutlineCheck {
  return { ...check, status: "settled", version };
}

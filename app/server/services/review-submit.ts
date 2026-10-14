import type { Comment, Issue } from "../schemas.js";
import {
  parseSubmitReviewBody,
  type ReviewRecordView,
  type ReviewSubmission,
} from "../schemas/review.js";
import { submittableRootIds } from "../../src/features/reviews/lib/review-submittable.js";
import { reviewThreadLocation } from "../../src/features/reviews/lib/review-thread-label.js";
import { IssueError } from "./errors.js";
import { create, readAll, readComments } from "./issues.js";
import { requireProject } from "./require-project.js";
import {
  assertNoTasking,
  assertThreadsStillSubmittable,
  newSubmissionFields,
  NO_READY_THREADS_ERROR,
  submitReviewAsTasks,
} from "./review-tasking.js";
import { readReviewView, updateStoredReview } from "./reviews.js";
import { appendThreadEvent } from "./thread-events.js";

/** Auto-plan stakeholder for an Idea made from review feedback. */
export const REVIEW_IDEA_STAKEHOLDER = "grok-4.7";

/** Author of the reply that resolves each thread sent to an Idea. */
export const REVIEW_SUBMIT_ROLE = "review-submit";

type ReviewSource = Pick<ReviewRecordView, "id" | "title" | "story" | "pr">;

type FeedbackThread = { root: Comment; replies: Comment[] };

/**
 * Record the submission for its destination. `story` leaves a tasking
 * submission for the route to launch; `idea` is done when this returns.
 */
export async function submitReview(
  projectId: string,
  reviewId: string,
  body: unknown,
): Promise<ReviewRecordView> {
  const parsed = parseSubmitReviewBody(body);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  const summary = parsed.body.summary?.trim() || undefined;
  if (parsed.body.destination === "idea") {
    return submitReviewAsIdea(projectId, reviewId, summary);
  }
  return submitReviewAsTasks(projectId, reviewId, summary);
}

/**
 * The branch the follow-up builds on: the pull request head, or its base for
 * a fork (the head lives in another repository), else the Story branch.
 */
export function reviewFollowUpBase(review: ReviewSource, issues: readonly Issue[]): string {
  if (review.pr) return review.pr.fork ? review.pr.baseRef : review.pr.headRef;
  const story = issues.find((issue) => issue.id === review.story);
  if (story?.kind === "story" && story.branchName) return story.branchName;
  throw new IssueError("validation", `review "${review.id}" has no branch to build on`);
}

function sourceText(review: ReviewSource): string {
  const sources: string[] = [];
  if (review.story) sources.push(`Story \`${review.story}\``);
  if (review.pr) sources.push(`pull request [#${review.pr.number}](${review.pr.url})`);
  return sources.join(" and ");
}

function authorText(comment: Comment): string {
  return comment.name ? `${comment.name} (${comment.role})` : comment.role;
}

function threadSection({ root, replies }: FeedbackThread): string {
  const location = reviewThreadLocation(root.anchor);
  const heading = root.anchor ? `\`${location}\`` : location;
  const messages = [root, ...replies].map(
    (comment) => `**${authorText(comment)}:** ${comment.body}`,
  );
  return [`### ${heading}`, ...messages].join("\n\n");
}

function reviewIdeaTitle(review: ReviewSource): string {
  return `Review feedback: ${review.title}`;
}

/** Planner context, then the optional summary, then each thread in order. */
export function reviewIdeaDescription(input: {
  review: ReviewSource;
  mergeBase: string;
  summary: string | undefined;
  threads: readonly FeedbackThread[];
}): string {
  const { review, mergeBase, summary, threads } = input;
  const sections = [
    `Feedback from review \`${review.id}\` of ${sourceText(review)}, sent to a ` +
      `follow-up instead of Tasks on the change. Each thread below is one ` +
      `reviewer concern. The plan builds on \`${mergeBase}\`.`,
  ];
  if (summary) sections.push("## Summary", summary);
  sections.push("## Threads", ...threads.map(threadSection));
  return `${sections.join("\n\n")}\n`;
}

function feedbackThreads(
  messages: readonly Comment[],
  rootIds: readonly string[],
): FeedbackThread[] {
  return rootIds.map((rootId) => ({
    root: messages.find((message) => message.id === rootId)!,
    replies: messages
      .filter((message) => message.replyTo === rootId)
      .sort((a, b) => a.at.localeCompare(b.at)),
  }));
}

/**
 * Queue a project-level Idea for auto-plan with every ready thread as its
 * feedback, record a done submission naming it, and resolve each thread with
 * a reply naming it.
 */
export async function submitReviewAsIdea(
  projectId: string,
  reviewId: string,
  summary: string | undefined,
): Promise<ReviewRecordView> {
  const project = requireProject(projectId);
  const { issues } = readAll();
  const review = readReviewView(project, reviewId, issues);
  assertNoTasking(review.submissions);
  const comments = readComments(reviewId, issues);
  const threadIds = submittableRootIds(comments.threads, review.submissions);
  if (threadIds.length === 0) {
    throw new IssueError("validation", NO_READY_THREADS_ERROR);
  }
  const mergeBase = reviewFollowUpBase(review, issues);

  const idea = await create(
    {
      kind: "idea",
      partOf: project,
      title: reviewIdeaTitle(review),
      stakeholder: REVIEW_IDEA_STAKEHOLDER,
      description: reviewIdeaDescription({
        review,
        mergeBase,
        summary,
        threads: feedbackThreads(comments.messages, threadIds),
      }),
    },
    { mergeBase, queuePlan: true },
  );

  const submission: ReviewSubmission = {
    ...(await newSubmissionFields(reviewId, summary, threadIds)),
    status: "done",
    taskIds: [],
    ideaId: idea.id,
  };
  updateStoredReview(project, reviewId, (current) => {
    assertNoTasking(current.submissions);
    assertThreadsStillSubmittable(reviewId, current.submissions, threadIds);
    return {
      ...current,
      updatedAt: submission.at,
      submissions: [...current.submissions, submission],
    };
  });

  for (const threadId of threadIds) {
    await appendThreadEvent(reviewId, threadId, {
      event: "resolved",
      by: { role: REVIEW_SUBMIT_ROLE },
      body: `Handled in follow-up idea [${idea.id}](issue:${idea.id}).`,
    });
  }
  return readReviewView(project, reviewId);
}

import { Router, type RequestHandler, type Response } from "express";
import type { Issue } from "../schemas.js";
import type { ReviewRecordView, ReviewWorktreeSyncHold } from "../schemas/review.js";
import { IssueError } from "../services/errors.js";
import { readAll } from "../services/issues.js";
import {
  readReviewCommits,
  readReviewDiff,
  readStoryReviewCommits,
  readStoryReviewDiff,
  storyReviewCommitsEtag,
} from "../services/review-diff.js";
import {
  readReviewProgress,
  setReviewMark,
  withReviewProgress,
} from "../services/review-marks.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import {
  launchRecordedSubmission,
  retryOpenReviewSubmissions,
  retryReviewSubmission,
} from "../services/review-tasking.js";
import {
  launchStandardsAssessment,
  launchSubmitAgents,
  retryStandardsAssessment,
  setStandardsProposal,
  submissionNeedsStandardsLaunch,
} from "../services/review-standards.js";
import { submitReview } from "../services/review-submit.js";
import { refreshReviewPullRequest } from "../services/review-pr-tracking.js";
import {
  reviewWorktreeHold,
  syncReviewWorktree,
} from "../services/review-worktree-sync.js";
import {
  archiveReview,
  listReviewViews,
  openOrCreateReview,
  readReviewView,
  reopenReview,
} from "../services/reviews.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

function storyIdQuery(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new IssueError("validation", "storyId must be a non-empty string");
  }
  return raw;
}

function requireStoryIdQuery(raw: unknown): string {
  const storyId = storyIdQuery(raw);
  if (storyId === undefined) {
    throw new IssueError("validation", "storyId must be a non-empty string");
  }
  return storyId;
}

function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (header === undefined || header.length === 0) return false;
  for (const part of header.split(",")) {
    if (part.trim() === etag) return true;
  }
  return false;
}

function scopeQuery(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new IssueError("validation", "scope must be a non-empty string");
  }
  return raw;
}

async function sendReview(
  res: Response,
  projectId: string,
  view: ReviewRecordView,
  status = 200,
  issues?: Issue[],
  synced?: { worktreeSync: ReviewWorktreeSyncHold | undefined },
): Promise<void> {
  const progressed = await withReviewProgress(projectId, view, issues);
  const worktreeSync = synced ? synced.worktreeSync : await reviewWorktreeHold(view.id);
  res.status(status).json(worktreeSync ? { ...progressed, worktreeSync } : progressed);
}

/**
 * Start tasking once the response has flushed. If sending throws before that,
 * start anyway: the submission is already recorded and would otherwise stay
 * tasking with no run.
 */
function sendReviewThenLaunch(
  res: Response,
  projectId: string,
  view: ReviewRecordView,
  status: number,
  launch: () => Promise<void>,
): Promise<void> {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    void launch();
  };
  res.on("finish", start);
  return sendReview(res, projectId, view, status).catch((err: unknown) => {
    start();
    throw err;
  });
}

export function createReviewsRouter(sessions: AgentSessions): Router {
  const reviewsRouter = Router({ mergeParams: true });

  reviewsRouter.post(
    "/",
    asyncRoute(async (req, res) => {
      const opened = await openOrCreateReview(req.params.projectId, req.body);
      if (opened.source === "pr") {
        res.status(opened.created ? 201 : 200).json({
          reviewId: opened.review.id,
          created: opened.created,
        });
        return;
      }
      const { created, review } = opened;
      await sendReview(res, req.params.projectId, review, created ? 201 : 200);
    }),
  );

  reviewsRouter.get(
    "/",
    asyncRoute(async (req, res) => {
      const { issues } = readAll();
      const listed = listReviewViews(
        req.params.projectId,
        storyIdQuery(req.query.storyId),
        issues,
      );
      res.json({ reviews: listed.reviews });
    }),
  );

  reviewsRouter.get(
    "/commits",
    asyncRoute(async (req, res) => {
      const projectId = req.params.projectId;
      const storyId = requireStoryIdQuery(req.query.storyId);
      const etag = storyReviewCommitsEtag(projectId, storyId);
      res.set("ETag", etag);
      if (ifNoneMatchHits(req.get("If-None-Match"), etag)) {
        res.status(304).end();
        return;
      }
      res.json(await readStoryReviewCommits(projectId, storyId));
    }),
  );

  reviewsRouter.get(
    "/diff",
    asyncRoute(async (req, res) => {
      res.json(
        await readStoryReviewDiff(
          req.params.projectId,
          requireStoryIdQuery(req.query.storyId),
          scopeQuery(req.query.scope),
        ),
      );
    }),
  );

  reviewsRouter.get(
    "/:reviewId",
    asyncRoute(async (req, res) => {
      if (req.query.refreshHead === "1") {
        await refreshReviewPullRequest(req.params.projectId, req.params.reviewId);
      }
      const worktreeSync = await syncReviewWorktree(req.params.reviewId, "auto");
      const { issues } = readAll();
      await sendReview(
        res,
        req.params.projectId,
        readReviewView(req.params.projectId, req.params.reviewId, issues),
        200,
        issues,
        { worktreeSync },
      );
    }),
  );

  reviewsRouter.get(
    "/:reviewId/progress",
    asyncRoute(async (req, res) => {
      const { issues } = readAll();
      const view = readReviewView(req.params.projectId, req.params.reviewId, issues);
      res.json(
        await readReviewProgress(req.params.projectId, view, issues),
      );
    }),
  );

  reviewsRouter.get(
    "/:reviewId/commits",
    asyncRoute(async (req, res) => {
      res.json(await readReviewCommits(req.params.projectId, req.params.reviewId));
    }),
  );

  reviewsRouter.get(
    "/:reviewId/diff",
    asyncRoute(async (req, res) => {
      res.json(
        await readReviewDiff(
          req.params.projectId,
          req.params.reviewId,
          scopeQuery(req.query.scope),
        ),
      );
    }),
  );

  reviewsRouter.post(
    "/:reviewId/worktree/sync",
    asyncRoute(async (req, res) => {
      const worktreeSync = await syncReviewWorktree(req.params.reviewId, "now");
      const { issues } = readAll();
      await sendReview(
        res,
        req.params.projectId,
        readReviewView(req.params.projectId, req.params.reviewId, issues),
        200,
        issues,
        { worktreeSync },
      );
    }),
  );

  reviewsRouter.post(
    "/:reviewId/archive",
    asyncRoute(async (req, res) => {
      await sendReview(
        res,
        req.params.projectId,
        await archiveReview(req.params.projectId, req.params.reviewId),
      );
    }),
  );

  reviewsRouter.post(
    "/:reviewId/reopen",
    asyncRoute(async (req, res) => {
      await sendReview(
        res,
        req.params.projectId,
        await reopenReview(req.params.projectId, req.params.reviewId),
      );
    }),
  );

  reviewsRouter.post(
    "/:reviewId/submissions",
    asyncRoute(async (req, res) => {
      const projectId = req.params.projectId;
      const reviewId = req.params.reviewId;
      const view = await submitReview(projectId, reviewId, req.body);
      await sendReviewThenLaunch(res, projectId, view, 201, () =>
        launchSubmitAgents(projectId, reviewId, view, sessions),
      );
    }),
  );

  reviewsRouter.post(
    "/:reviewId/submissions/retry",
    asyncRoute(async (req, res) => {
      const projectId = req.params.projectId;
      const reviewId = req.params.reviewId;
      const view = await retryOpenReviewSubmissions(
        projectId,
        reviewId,
        req.body,
        sessions,
      );
      const launching = view.submissions.filter((item) => item.status === "tasking");
      await sendReviewThenLaunch(res, projectId, view, 200, async () => {
        for (const submission of launching) {
          await launchRecordedSubmission(
            projectId,
            reviewId,
            submission.id,
            "retry",
            sessions,
          );
        }
      });
    }),
  );

  reviewsRouter.post(
    "/:reviewId/submissions/:submissionId/standards/retry",
    asyncRoute(async (req, res) => {
      const projectId = req.params.projectId;
      const reviewId = req.params.reviewId;
      const submissionId = req.params.submissionId;
      const view = retryStandardsAssessment(
        projectId,
        reviewId,
        submissionId,
        req.body,
        sessions,
      );
      const submission = view.submissions.find((item) => item.id === submissionId);
      await sendReviewThenLaunch(res, projectId, view, 200, () =>
        submission && submissionNeedsStandardsLaunch(submission)
          ? launchStandardsAssessment(projectId, reviewId, submission.id, sessions)
          : Promise.resolve(),
      );
    }),
  );

  reviewsRouter.patch(
    "/:reviewId/submissions/:submissionId/standards/proposals/:proposalId",
    asyncRoute(async (req, res) => {
      const { projectId, reviewId, submissionId, proposalId } = req.params;
      await sendReview(
        res,
        projectId,
        setStandardsProposal(projectId, reviewId, submissionId, proposalId, req.body),
      );
    }),
  );

  reviewsRouter.post(
    "/:reviewId/submissions/:submissionId/retry",
    asyncRoute(async (req, res) => {
      const projectId = req.params.projectId;
      const reviewId = req.params.reviewId;
      const submissionId = req.params.submissionId;
      const view = await retryReviewSubmission(
        projectId,
        reviewId,
        submissionId,
        req.body,
        sessions,
      );
      const submission = view.submissions.find((item) => item.id === submissionId);
      await sendReviewThenLaunch(res, projectId, view, 200, () =>
        submission?.status === "tasking"
          ? launchRecordedSubmission(
              projectId,
              reviewId,
              submission.id,
              "retry",
              sessions,
            )
          : Promise.resolve(),
      );
    }),
  );

  reviewsRouter.put(
    "/:reviewId/marks",
    asyncRoute(async (req, res) => {
      res.json(await setReviewMark(req.params.projectId, req.params.reviewId, req.body));
    }),
  );

  return reviewsRouter;
}

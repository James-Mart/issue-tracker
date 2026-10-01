import { Router, type RequestHandler, type Response } from "express";
import type { ReviewRecordView } from "../schemas/review.js";
import { IssueError } from "../services/errors.js";
import { readReviewCommits, readReviewDiff } from "../services/review-diff.js";
import {
  setReviewMark,
  withReviewProgress,
  withReviewProgressList,
} from "../services/review-marks.js";
import type { AgentSessions } from "../services/agent-sessions.js";
import {
  launchRecordedSubmission,
  retryReviewSubmission,
  submitReview,
} from "../services/review-tasking.js";
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
): Promise<void> {
  res.status(status).json(await withReviewProgress(projectId, view));
}

async function sendReviewList(
  res: Response,
  projectId: string,
  views: ReviewRecordView[],
): Promise<void> {
  res.json({ reviews: await withReviewProgressList(projectId, views) });
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
      const { created, review } = openOrCreateReview(req.params.projectId, req.body);
      await sendReview(res, req.params.projectId, review, created ? 201 : 200);
    }),
  );

  reviewsRouter.get(
    "/",
    asyncRoute(async (req, res) => {
      const listed = listReviewViews(req.params.projectId, storyIdQuery(req.query.storyId));
      await sendReviewList(res, req.params.projectId, listed.reviews);
    }),
  );

  reviewsRouter.get(
    "/:reviewId",
    asyncRoute(async (req, res) => {
      await sendReview(
        res,
        req.params.projectId,
        readReviewView(req.params.projectId, req.params.reviewId),
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
    "/:reviewId/archive",
    asyncRoute(async (req, res) => {
      await sendReview(
        res,
        req.params.projectId,
        archiveReview(req.params.projectId, req.params.reviewId),
      );
    }),
  );

  reviewsRouter.post(
    "/:reviewId/reopen",
    asyncRoute(async (req, res) => {
      await sendReview(
        res,
        req.params.projectId,
        reopenReview(req.params.projectId, req.params.reviewId),
      );
    }),
  );

  reviewsRouter.post(
    "/:reviewId/submissions",
    asyncRoute(async (req, res) => {
      const projectId = req.params.projectId;
      const reviewId = req.params.reviewId;
      const view = await submitReview(projectId, reviewId, req.body);
      const pending = view.submissions.find(
        (item) => item.status === "tasking" && !item.conversationId,
      );
      await sendReviewThenLaunch(res, projectId, view, 201, () =>
        pending
          ? launchRecordedSubmission(projectId, reviewId, pending.id, "start", sessions)
          : Promise.resolve(),
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

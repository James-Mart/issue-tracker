import { Router, type RequestHandler, type Response } from "express";
import type { ReviewRecordView } from "../schemas/review.js";
import { IssueError } from "../services/errors.js";
import { readReviewCommits, readReviewDiff } from "../services/review-diff.js";
import {
  setReviewMark,
  withReviewProgress,
  withReviewProgressList,
} from "../services/review-marks.js";
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

export const reviewsRouter = Router({ mergeParams: true });

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

reviewsRouter.put(
  "/:reviewId/marks",
  asyncRoute(async (req, res) => {
    res.json(await setReviewMark(req.params.projectId, req.params.reviewId, req.body));
  }),
);

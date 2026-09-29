import { Router, type RequestHandler } from "express";
import { IssueError } from "../services/errors.js";
import { readReviewCommits, readReviewDiff } from "../services/review-diff.js";
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

export const reviewsRouter = Router({ mergeParams: true });

reviewsRouter.post(
  "/",
  asyncRoute((req, res) => {
    const { created, review } = openOrCreateReview(req.params.projectId, req.body);
    res.status(created ? 201 : 200).json(review);
  }),
);

reviewsRouter.get(
  "/",
  asyncRoute((req, res) => {
    res.json(listReviewViews(req.params.projectId, storyIdQuery(req.query.storyId)));
  }),
);

reviewsRouter.get(
  "/:reviewId",
  asyncRoute((req, res) => {
    res.json(readReviewView(req.params.projectId, req.params.reviewId));
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
  asyncRoute((req, res) => {
    res.json(archiveReview(req.params.projectId, req.params.reviewId));
  }),
);

reviewsRouter.post(
  "/:reviewId/reopen",
  asyncRoute((req, res) => {
    res.json(reopenReview(req.params.projectId, req.params.reviewId));
  }),
);

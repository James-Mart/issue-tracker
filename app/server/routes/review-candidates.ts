import { Router, type RequestHandler } from "express";
import { IssueError } from "../services/errors.js";
import { listReviewCandidates } from "../services/review-candidates.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

function queryParam(raw: unknown): string {
  if (raw === undefined) return "";
  if (typeof raw !== "string") {
    throw new IssueError("validation", "query must be a string");
  }
  return raw;
}

function limitParam(raw: unknown, required: boolean): number | undefined {
  if (raw === undefined) {
    if (required) {
      throw new IssueError("validation", "limit is required when query is empty");
    }
    return undefined;
  }
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) {
    throw new IssueError("validation", "limit must be a positive integer");
  }
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit)) {
    throw new IssueError("validation", "limit must be a positive integer");
  }
  return limit;
}

export const reviewCandidatesRouter = Router({ mergeParams: true });

reviewCandidatesRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const query = queryParam(req.query.query);
    const limit = limitParam(req.query.limit, query === "");
    res.json(await listReviewCandidates(req.params.projectId, query, limit));
  }),
);

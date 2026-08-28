import { Router, type RequestHandler } from "express";
import { IssueError } from "../services/errors.js";
import { getPipelineStepSource } from "../services/pipeline-step-source.js";
import { recentRuns, runSequence } from "../services/run-sequence.js";

const DEFAULT_RUNS_LIMIT = 20;

function parseLimitQuery(raw: unknown): number | { error: string } {
  if (raw === undefined) return DEFAULT_RUNS_LIMIT;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== "string" && typeof text !== "number") {
    return { error: "limit must be a positive integer" };
  }
  const value = typeof text === "number" ? text : Number(text);
  if (!Number.isInteger(value) || value < 1) {
    return { error: "limit must be a positive integer" };
  }
  return value;
}

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export function createPipelineRouter(): Router {
  const router = Router();

  router.get(
    "/steps/:stepId/source",
    asyncRoute((req, res) => {
      res.json(getPipelineStepSource(req.params.stepId));
    }),
  );

  router.get(
    "/runs",
    asyncRoute((req, res) => {
      const limit = parseLimitQuery(req.query.limit);
      if (typeof limit === "object") {
        throw new IssueError("validation", limit.error);
      }
      res.json({ runs: recentRuns(limit) });
    }),
  );

  router.get(
    "/runs/:conversationId",
    asyncRoute((req, res) => {
      res.json(runSequence(req.params.conversationId));
    }),
  );

  return router;
}

export const pipelineRouter = createPipelineRouter();

import { Router, type RequestHandler } from "express";
import { getPipelineStepSource } from "../services/pipeline-step-source.js";

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

  return router;
}

export const pipelineRouter = createPipelineRouter();

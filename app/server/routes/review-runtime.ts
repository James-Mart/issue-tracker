import { Router, type RequestHandler } from "express";
import {
  readReviewRuntime,
  startReviewRuntime,
  stopReviewRuntime,
} from "../services/review-runtime.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export function createReviewRuntimeRouter(): Router {
  const router = Router();

  router.get(
    "/:id/runtime",
    asyncRoute(async (req, res) => {
      res.json(readReviewRuntime(req.params.id));
    }),
  );

  router.post(
    "/:id/runtime",
    asyncRoute(async (req, res) => {
      res.json(await startReviewRuntime(req.params.id));
    }),
  );

  router.delete(
    "/:id/runtime",
    asyncRoute(async (req, res) => {
      res.json(await stopReviewRuntime(req.params.id));
    }),
  );

  return router;
}

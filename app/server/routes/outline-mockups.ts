import { Router, type RequestHandler } from "express";
import {
  readOutlineMockupStack,
  startOutlineMockupStack,
  stopOutlineMockupStack,
} from "../services/outline-mockup-stack.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

/** `GET` / `POST` / `DELETE /api/issues/:id/mockups`. */
export function createOutlineMockupsRouter(): Router {
  const router = Router();

  router.get(
    "/:id/mockups",
    asyncRoute((req, res) => {
      res.json(readOutlineMockupStack(req.params.id));
    }),
  );

  router.post(
    "/:id/mockups",
    asyncRoute(async (req, res) => {
      res.json(await startOutlineMockupStack(req.params.id));
    }),
  );

  router.delete(
    "/:id/mockups",
    asyncRoute(async (req, res) => {
      res.json(await stopOutlineMockupStack(req.params.id));
    }),
  );

  return router;
}

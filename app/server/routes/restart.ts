import { Router, type RequestHandler } from "express";
import { bootId } from "../boot-info.js";
import { RESTART_SUPERVISED_ENV_VAR } from "../restart-contract.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export type InitiateRestart = () => void | Promise<void>;

export function createRestartRouter(
  initiateRestart: InitiateRestart,
): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (_req, res) => {
      if (!process.env[RESTART_SUPERVISED_ENV_VAR]) {
        res.status(409).json({ code: "not-supervised" });
        return;
      }

      res.on("finish", () => {
        void Promise.resolve(initiateRestart());
      });

      res.status(202).json({ bootId });
    }),
  );

  return router;
}

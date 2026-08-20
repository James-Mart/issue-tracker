import { Router, type RequestHandler } from "express";
import { bootId } from "../boot-info.js";
import { isRestartSupervised } from "../restart-contract.js";
import type { AgentSessions } from "../services/agent-sessions.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export type InitiateRestart = () => void | Promise<void>;

export function createRestartRouter(
  sessions: AgentSessions,
  initiateRestart: InitiateRestart,
): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (req, res) => {
      if (!isRestartSupervised()) {
        res.status(409).json({ code: "not-supervised" });
        return;
      }

      const force = req.body?.force === true;
      if (!force) {
        const activeRuns = sessions.listActiveRuns();
        if (activeRuns.length > 0) {
          res.status(409).json({ code: "runs-in-flight", activeRuns });
          return;
        }
      }

      res.on("finish", () => {
        void Promise.resolve(initiateRestart());
      });

      res.status(202).json({ bootId });
    }),
  );

  return router;
}

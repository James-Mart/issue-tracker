import { Router } from "express";
import { bootId, processStartedAt } from "../boot-info.js";
import { isRestartSupervised } from "../restart-contract.js";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      bootId,
      startedAt: new Date(processStartedAt).toISOString(),
      restartSupported: isRestartSupervised(),
    });
  });

  return router;
}

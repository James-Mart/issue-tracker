import { Router, type RequestHandler } from "express";
import { agentSdk, CursorAgentError, type AgentSdk } from "../services/agent-sdk.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export function createAgentModelsRouter(sdk: AgentSdk = agentSdk): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      try {
        const models = await sdk.listModels();
        res.json({ models });
      } catch (err) {
        if (err instanceof CursorAgentError) {
          res.status(502).json({ error: err.message });
          return;
        }
        throw err;
      }
    }),
  );

  return router;
}

export const agentModelsRouter = createAgentModelsRouter();

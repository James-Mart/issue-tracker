import { Router, type RequestHandler } from "express";
import {
  refreshAgentModelSlugCatalog,
  type RefreshAgentModelSlugCatalogOptions,
} from "../agent-model-slugs-sync.js";
import { agentSdk, CursorAgentError, type AgentSdk } from "../services/agent-sdk.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export type AgentModelsRouterOptions = Omit<
  RefreshAgentModelSlugCatalogOptions,
  "sdk"
>;

export function createAgentModelsRouter(
  sdk: AgentSdk = agentSdk,
  refreshOptions: AgentModelsRouterOptions = {},
): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute(async (_req, res) => {
      try {
        const models = await refreshAgentModelSlugCatalog({
          sdk,
          ...refreshOptions,
        });
        if (models === null) {
          throw new Error("agent model slug catalog sync is disabled");
        }
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

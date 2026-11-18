import { Router } from "express";
import {
  readCapabilityCatalog,
  type CapabilityCatalog,
} from "../services/capability-catalog.js";

export function createAgentCapabilitiesRouter(
  read: () => CapabilityCatalog = readCapabilityCatalog,
): Router {
  const router = Router();
  router.get("/", (_req, res, next) => {
    try {
      res.json(read());
    } catch (err) {
      next(err);
    }
  });
  return router;
}

export const agentCapabilitiesRouter = createAgentCapabilitiesRouter();

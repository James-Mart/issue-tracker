import { Router, type RequestHandler } from "express";
import {
  channelSessionsBatchBodySchema,
  formatZodError,
} from "../schemas.js";
import {
  agentSessions,
  type AgentSessions,
} from "../services/agent-sessions.js";
import { listChannelSessionsForPairs } from "../services/channel-session-list.js";
import { IssueError } from "../services/errors.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export function createChannelSessionsRouter(
  sessions: AgentSessions = agentSessions,
): Router {
  const router = Router();

  router.post(
    "/",
    asyncRoute(async (req, res) => {
      const parsed = channelSessionsBatchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new IssueError(
          "validation",
          formatZodError(parsed.error, "invalid channel-sessions body"),
        );
      }
      res.json({
        sessions: await listChannelSessionsForPairs(parsed.data.pairs, sessions),
      });
    }),
  );

  return router;
}

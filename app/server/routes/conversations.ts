import { Router, type RequestHandler } from "express";
import {
  agentSessions,
  type AgentSessions,
} from "../services/agent-sessions.js";
import {
  appendEvent,
  createConversation,
  deleteConversation,
  listConversations,
  readConversation,
  updateMeta,
} from "../services/conversations.js";
import { requireProjectWorkspace } from "../services/project-workspace.js";
import type { ConversationMetaPatch } from "../schemas.js";

const DEFAULT_TITLE = "New conversation";
const DEFAULT_MODEL = "auto";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export function createConversationsRouter(
  sessions: AgentSessions = agentSessions,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(listConversations());
  });

  router.get(
    "/:id",
    asyncRoute(async (req, res) => {
      res.json(readConversation(req.params.id));
    }),
  );

  router.post(
    "/",
    asyncRoute(async (req, res) => {
      const body = req.body as {
        projectId?: unknown;
        title?: unknown;
        model?: unknown;
      };
      const projectId =
        typeof body.projectId === "string" ? body.projectId.trim() : "";
      if (!projectId) {
        res.status(400).json({ error: "projectId is required" });
        return;
      }

      requireProjectWorkspace(projectId);

      const title =
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : DEFAULT_TITLE;
      const model =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : DEFAULT_MODEL;

      const meta = await createConversation({ projectId, title, model });
      res.status(201).json(meta);
    }),
  );

  router.patch(
    "/:id",
    asyncRoute(async (req, res) => {
      const body = req.body as { title?: unknown; model?: unknown };
      const patch: ConversationMetaPatch = {};
      if (body.title !== undefined) {
        if (typeof body.title !== "string") {
          res.status(400).json({ error: "title must be a string" });
          return;
        }
        patch.title = body.title;
      }
      if (body.model !== undefined) {
        if (typeof body.model !== "string") {
          res.status(400).json({ error: "model must be a string" });
          return;
        }
        patch.model = body.model;
      }
      if (patch.title === undefined && patch.model === undefined) {
        res.status(400).json({ error: "title or model is required" });
        return;
      }

      const meta = await updateMeta(req.params.id, patch);
      res.json(meta);
    }),
  );

  router.delete(
    "/:id",
    asyncRoute(async (req, res) => {
      await sessions.dispose(req.params.id);
      await deleteConversation(req.params.id);
      res.status(204).end();
    }),
  );

  router.post(
    "/:id/messages",
    asyncRoute(async (req, res) => {
      const body = req.body as { prompt?: unknown; model?: unknown };
      const prompt =
        typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      const model =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : undefined;

      await appendEvent(req.params.id, { type: "prompt", text: prompt });

      const result = await sessions.sendPrompt(req.params.id, {
        prompt,
        model,
      });
      if (!result.ok) {
        res.status(502).json({ error: result.error.message });
        return;
      }

      res.status(202).json({ runId: result.run.id });
    }),
  );

  return router;
}

export const conversationsRouter = createConversationsRouter();

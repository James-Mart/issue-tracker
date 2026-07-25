import { Router, type RequestHandler, type Response } from "express";
import {
  agentSessions,
  type AgentSessions,
} from "../services/agent-sessions.js";
import { publishFrame, subscribeFrames } from "../services/conversation-stream.js";
import {
  appendEvent,
  createConversation,
  deleteConversation,
  listConversations,
  readConversation,
  updateMeta,
} from "../services/conversations.js";
import { requireProjectWorkspace } from "../services/project-workspace.js";
import type { ConversationMetaPatch, TranscriptEvent } from "../schemas.js";

const DEFAULT_TITLE = "New conversation";
const DEFAULT_MODEL = "auto";
const HEARTBEAT_MS = 10_000;
const HEARTBEAT_PAYLOAD = "event: ping\ndata: {}\n\n";

function sendSse(res: Response, payload: string): boolean {
  if (res.writableEnded) return false;
  try {
    res.write(payload);
    return true;
  } catch (err) {
    console.error("dropping unwritable conversation SSE client:", err);
    return false;
  }
}

function sseDataFrame(event: TranscriptEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

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

  router.get(
    "/:id/events",
    asyncRoute(async (req, res) => {
      const { meta, transcript } = readConversation(req.params.id);

      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      for (const event of transcript) {
        if (!sendSse(res, sseDataFrame(event))) return;
      }

      const unsubscribe = subscribeFrames(meta.id, (frame) => {
        sendSse(
          res,
          `data: ${JSON.stringify({
            ...frame.event,
            at: new Date().toISOString(),
          })}\n\n`,
        );
      });

      sendSse(res, HEARTBEAT_PAYLOAD);
      const heartbeat = setInterval(
        () => sendSse(res, HEARTBEAT_PAYLOAD),
        HEARTBEAT_MS,
      );

      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      });
    }),
  );

  router.post(
    "/:id/cancel",
    asyncRoute(async (req, res) => {
      const cancelled = await sessions.cancel(req.params.id);
      if (!cancelled) {
        res.status(409).json({ error: "No active run to cancel" });
        return;
      }
      res.sendStatus(200);
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
        const message = result.error.message;
        const event = { type: "error" as const, message };
        await appendEvent(req.params.id, event);
        publishFrame(req.params.id, { event, persist: true });
        res.status(502).json({ error: message });
        return;
      }

      res.status(202).json({ runId: result.run.id });
    }),
  );

  return router;
}

export const conversationsRouter = createConversationsRouter();

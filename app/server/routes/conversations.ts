import { Router, type RequestHandler, type Response } from "express";
import { basename } from "path";
import { uploadConversationAttachment } from "../middleware/upload-conversation-attachment.js";
import {
  agentSessions,
  type AgentSessions,
} from "../services/agent-sessions.js";
import {
  getConversationAttachment,
  listConversationAttachments,
  putConversationAttachment,
  removeConversationAttachment,
} from "../services/conversation-attachments.js";
import { IssueError } from "../services/errors.js";
import {
  createConversation,
  deleteConversation,
  listConversations,
  readConversation,
  setPendingMessage,
  startConversationPrompt,
  updateMeta,
} from "../services/conversations.js";
import { requireProjectWorkspace } from "../services/project-workspace.js";
import {
  assertConversationActiveRun,
  assertConversationAttachmentMeta,
  assertConversationAttachmentsList,
  assertConversationListItem,
  assertConversationTranscriptPage,
  type ConversationActiveRun,
  type ConversationMetaPatch,
} from "../schemas.js";

const DEFAULT_TITLE = "New conversation";
const DEFAULT_MODEL = "auto";

function parseSinceSeqQuery(raw: unknown): number | { error: string } {
  if (raw === undefined) return 0;
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== "string" && typeof text !== "number") {
    return { error: "sinceSeq must be a non-negative integer" };
  }
  const value = typeof text === "number" ? text : Number(text);
  if (!Number.isInteger(value) || value < 0) {
    return { error: "sinceSeq must be a non-negative integer" };
  }
  return value;
}

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

function activeRunState(
  sessions: AgentSessions,
  conversationId: string,
): ConversationActiveRun {
  const run = sessions.getActiveRun(conversationId);
  if (!run) {
    return { active: false, runId: null, startedAt: null };
  }
  return { active: true, runId: run.id, startedAt: run.startedAt };
}

async function deliverPrompt(
  conversationId: string,
  prompt: string,
  model: string | undefined,
  sessions: AgentSessions,
  res: Response,
): Promise<void> {
  const result = await startConversationPrompt(
    conversationId,
    prompt,
    model,
    sessions,
  );
  if (!result.ok) {
    res.status(502).json({ error: result.message });
    return;
  }
  res.status(202).json({ runId: result.runId });
}

export function createConversationsRouter(
  sessions: AgentSessions = agentSessions,
): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const showArchived = req.query.showArchived === "true";
    res.json(
      listConversations()
        .filter((meta) => !meta.issueId)
        .filter((meta) => showArchived || !meta.archived)
        .map((meta) =>
          assertConversationListItem({
            ...meta,
            activeRun: activeRunState(sessions, meta.id).active,
          }),
        ),
    );
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
        message?: unknown;
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
      const message =
        typeof body.message === "string" ? body.message.trim() : "";

      const meta = await createConversation({
        projectId,
        title,
        model,
        ...(message ? { message } : {}),
      });

      // Run start is outside serialize: sendPrompt → updateMeta(agentId) would
      // deadlock if nested inside the conversations write chain.
      if (message) {
        const started = await startConversationPrompt(
          meta.id,
          message,
          model,
          sessions,
          { persistPrompt: false },
        );
        if (!started.ok) {
          res.status(502).json({ error: started.message });
          return;
        }
      }

      res.status(201).json(meta);
    }),
  );

  router.patch(
    "/:id",
    asyncRoute(async (req, res) => {
      const body = req.body as {
        title?: unknown;
        model?: unknown;
        archived?: unknown;
      };
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
      if (body.archived !== undefined) {
        if (typeof body.archived !== "boolean") {
          res.status(400).json({ error: "archived must be a boolean" });
          return;
        }
        patch.archived = body.archived;
      }
      if (
        patch.title === undefined &&
        patch.model === undefined &&
        patch.archived === undefined
      ) {
        res.status(400).json({ error: "title, model, or archived is required" });
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
    "/:id/run",
    asyncRoute(async (req, res) => {
      readConversation(req.params.id);
      res.json(
        assertConversationActiveRun(activeRunState(sessions, req.params.id)),
      );
    }),
  );

  router.get(
    "/:id/transcript",
    asyncRoute(async (req, res) => {
      const sinceSeq = parseSinceSeqQuery(req.query.sinceSeq);
      if (typeof sinceSeq === "object") {
        res.status(400).json({ error: sinceSeq.error });
        return;
      }

      const { transcript } = readConversation(req.params.id);
      const latestSeq = transcript.at(-1)?.seq ?? 0;
      const events = transcript.filter((event) => (event.seq ?? 0) > sinceSeq);
      res.json(
        assertConversationTranscriptPage({ events, latestSeq }),
      );
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

  router.patch(
    "/:id/pending",
    asyncRoute(async (req, res) => {
      const body = req.body as { text?: unknown };
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        res.status(400).json({ error: "text is required" });
        return;
      }

      const meta = await setPendingMessage(req.params.id, text);
      res.json(meta);
    }),
  );

  router.delete(
    "/:id/pending",
    asyncRoute(async (req, res) => {
      await setPendingMessage(req.params.id, null);
      res.status(204).end();
    }),
  );

  router.get(
    "/:id/attachments",
    asyncRoute(async (req, res) => {
      const attachments = await listConversationAttachments(req.params.id);
      res.json(
        assertConversationAttachmentsList({
          attachments: attachments.map((meta) =>
            assertConversationAttachmentMeta(meta),
          ),
        }),
      );
    }),
  );

  router.post(
    "/:id/attachments",
    uploadConversationAttachment,
    asyncRoute(async (req, res) => {
      const file = req.file;
      if (!file) {
        throw new IssueError("validation", "attachment is required");
      }
      const name = basename(file.originalname);
      const meta = await putConversationAttachment(
        req.params.id,
        name,
        file.buffer,
      );
      res.status(201).json(assertConversationAttachmentMeta(meta));
    }),
  );

  router.get(
    "/:id/attachments/:name",
    asyncRoute(async (req, res) => {
      const { bytes, mimeType } = await getConversationAttachment(
        req.params.id,
        req.params.name,
      );
      res.type(mimeType);
      res.send(bytes);
    }),
  );

  router.delete(
    "/:id/attachments/:name",
    asyncRoute(async (req, res) => {
      await removeConversationAttachment(req.params.id, req.params.name);
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

      const conversationId = req.params.id;
      const activeRun = sessions.getActiveRun(conversationId);
      if (activeRun) {
        await setPendingMessage(conversationId, prompt);
        res.status(202).json({ pending: true });
        return;
      }

      const model =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : undefined;

      await deliverPrompt(conversationId, prompt, model, sessions, res);
    }),
  );

  router.post(
    "/:id/interrupt",
    asyncRoute(async (req, res) => {
      const body = req.body as { prompt?: unknown; model?: unknown };
      const prompt =
        typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      const conversationId = req.params.id;
      const model =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : undefined;

      const activeRun = sessions.getActiveRun(conversationId);
      if (activeRun) {
        await sessions.cancel(conversationId);
        await activeRun.wait();
      }

      await deliverPrompt(conversationId, prompt, model, sessions, res);
    }),
  );

  return router;
}

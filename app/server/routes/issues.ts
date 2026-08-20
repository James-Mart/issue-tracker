import { Router, type RequestHandler } from "express";
import { basename } from "path";
import { mergeStory } from "../../cli-ops.js";
import {
  CONVERSATION_CHANNELS,
  type CommentInput,
  type ConversationChannel,
  type CreateInput,
  formatZodError,
  type IssuePatch,
  mergeStoryBodySchema,
} from "../schemas.js";
import { uploadAttachment } from "../middleware/upload-attachment.js";
import {
  agentSessions,
  type AgentSessions,
} from "../services/agent-sessions.js";
import {
  getAttachment,
  listAttachments,
  putAttachment,
  removeAttachment,
} from "../services/attachments.js";
import { IssueError } from "../services/errors.js";
import {
  findAgentRunsWorkRoot,
  listAgentRunsForIssue,
} from "../services/agent-runs.js";
import {
  appendComment,
  create,
  list,
  read,
  readAll,
  readComments,
  readIssueOrThrow,
  remove,
  update,
} from "../services/issues.js";
import {
  createIssueChannelSession,
  listConversations,
  startConversationPrompt,
} from "../services/conversations.js";
import { moveStory } from "../services/move-story.js";
import { requireProjectWorkspace } from "../services/project-workspace.js";
import { findPlanningWorkRoot } from "../services/planning-work-root.js";
import { reorderBoardChild } from "../services/reorder-board.js";
import { ancestorChain } from "../services/subtree.js";

const DEFAULT_TITLE = "New conversation";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

function parseChannelParam(raw: string): ConversationChannel {
  if ((CONVERSATION_CHANNELS as readonly string[]).includes(raw)) {
    return raw as ConversationChannel;
  }
  throw new IssueError(
    "validation",
    `channel must be one of ${CONVERSATION_CHANNELS.join(", ")}`,
  );
}

function projectIdForIssue(issueId: string): string {
  const { issues } = readAll();
  return ancestorChain(issueId, issues)[0]!.id;
}

function activeRunFlag(
  sessions: AgentSessions,
  conversationId: string,
): boolean {
  return sessions.getActiveRun(conversationId) !== undefined;
}

export function createIssuesRouter(
  sessions: AgentSessions = agentSessions,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(list());
  });

  router.get(
    "/:id",
    asyncRoute((req, res) => {
      res.json(read(req.params.id));
    }),
  );

  router.get(
    "/:id/comments",
    asyncRoute((req, res) => {
      res.json(readComments(req.params.id));
    }),
  );

  router.get(
    "/:id/agent-runs",
    asyncRoute((req, res) => {
      const issueId = req.params.id;
      readIssueOrThrow(issueId);
      const { issues } = readAll();
      const workRoot = findAgentRunsWorkRoot(issueId, issues);
      res.json({
        runs: listAgentRunsForIssue(issueId),
        ...(workRoot ? { workRoot } : {}),
      });
    }),
  );

  router.get(
    "/:id/planning-work-root",
    asyncRoute((req, res) => {
      const issueId = req.params.id;
      const issue = readIssueOrThrow(issueId);
      if (issue.kind !== "idea") {
        throw new IssueError(
          "validation",
          "planning-work-root is only defined for Ideas",
        );
      }
      const { issues } = readAll();
      res.json({ workRoot: findPlanningWorkRoot(issueId, issues) });
    }),
  );

  router.get(
    "/:id/channels/:channel/sessions",
    asyncRoute((req, res) => {
      const issueId = req.params.id;
      readIssueOrThrow(issueId);
      const channel = parseChannelParam(req.params.channel);
      res.json(
        listConversations()
          .filter(
            (meta) => meta.issueId === issueId && meta.channel === channel,
          )
          .map((meta) => ({
            id: meta.id,
            title: meta.title,
            model: meta.model,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
            archived: meta.archived,
            activeRun: activeRunFlag(sessions, meta.id),
          })),
      );
    }),
  );

  router.post(
    "/:id/channels/:channel/sessions",
    asyncRoute(async (req, res) => {
      const issueId = req.params.id;
      readIssueOrThrow(issueId);
      const channel = parseChannelParam(req.params.channel);
      const body = req.body as {
        model?: unknown;
        title?: unknown;
        message?: unknown;
      };
      const model =
        typeof body.model === "string" ? body.model.trim() : "";
      if (!model) {
        res.status(400).json({ error: "model is required" });
        return;
      }
      const title =
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : DEFAULT_TITLE;
      const message =
        typeof body.message === "string" ? body.message.trim() : "";

      const projectId = projectIdForIssue(issueId);
      requireProjectWorkspace(projectId);

      const { meta: created, initialPrompt } = await createIssueChannelSession(
        {
          projectId,
          title,
          model,
          issueId,
          channel,
          ...(message ? { message } : {}),
        },
        sessions,
      );

      // Run start is outside serialize: sendPrompt → updateMeta(agentId) would
      // deadlock if nested inside the conversations write chain.
      if (initialPrompt) {
        const started = await startConversationPrompt(
          created.id,
          initialPrompt,
          model,
          sessions,
          { persistPrompt: false },
        );
        if (!started.ok) {
          res.status(502).json({ error: started.message });
          return;
        }
      }

      res.status(201).json({ id: created.id });
    }),
  );

  router.get(
    "/:id/attachments",
    asyncRoute((req, res) => {
      res.json(listAttachments(req.params.id));
    }),
  );

  router.post(
    "/:id/attachments",
    uploadAttachment,
    asyncRoute(async (req, res) => {
      const file = req.file;
      if (!file) {
        throw new IssueError("validation", "file is required");
      }
      const name = basename(file.originalname);
      const meta = await putAttachment(req.params.id, name, file.buffer);
      res.status(201).json(meta);
    }),
  );

  router.get(
    "/:id/attachments/:name",
    asyncRoute(async (req, res) => {
      const { meta, bytes } = await getAttachment(
        req.params.id,
        req.params.name,
      );
      res.type(meta.mime);
      res.send(bytes);
    }),
  );

  router.delete(
    "/:id/attachments/:name",
    asyncRoute(async (req, res) => {
      await removeAttachment(req.params.id, req.params.name);
      res.status(204).end();
    }),
  );

  router.post(
    "/",
    asyncRoute(async (req, res) => {
      const record = await create(req.body as CreateInput);
      res.status(201).json(record);
    }),
  );

  router.post(
    "/:id/comments",
    asyncRoute(async (req, res) => {
      const message = await appendComment(
        req.params.id,
        req.body as CommentInput,
      );
      res.status(201).json(message);
    }),
  );

  router.post(
    "/:id/move-story",
    asyncRoute(async (req, res) => {
      const target = (req.body as { target?: unknown })?.target;
      if (typeof target !== "string" || !target) {
        res.status(400).json({ error: "target is required" });
        return;
      }
      const result = await moveStory(req.params.id, target);
      res.json(result);
    }),
  );

  router.post(
    "/:id/merge",
    asyncRoute(async (req, res) => {
      const parsed = mergeStoryBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new IssueError(
          "validation",
          formatZodError(parsed.error, "invalid merge body"),
        );
      }
      await mergeStory(req.params.id, parsed.data);
      res.status(204).end();
    }),
  );

  router.post(
    "/:id/reorder",
    asyncRoute(async (req, res) => {
      const before = (req.body as { before?: unknown })?.before;
      if (typeof before !== "string" || !before) {
        res.status(400).json({ error: "before is required" });
        return;
      }
      const result = await reorderBoardChild(req.params.id, before);
      res.json(result);
    }),
  );

  router.patch(
    "/:id",
    asyncRoute(async (req, res) => {
      const record = await update(req.params.id, req.body as IssuePatch);
      res.json(record);
    }),
  );

  router.delete(
    "/:id",
    asyncRoute(async (req, res) => {
      const result = await remove(req.params.id);
      res.json(result);
    }),
  );

  return router;
}

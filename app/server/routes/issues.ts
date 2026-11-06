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
  isInclusionThreadEvent,
  threadEventRequestSchema,
} from "../schemas.js";
import { uploadAttachment } from "../middleware/upload-attachment.js";
import {
  agentSessions,
  type AgentSessions,
} from "../services/agent-sessions.js";
import {
  getAttachment,
  listAttachments,
  postAttachment,
  removeAttachment,
} from "../services/attachments.js";
import { IssueError } from "../services/errors.js";
import {
  findAgentRunsWorkRoot,
  listAgentRunEvents,
  listAgentRunsForIssue,
} from "../services/agent-runs.js";
import {
  appendComment,
  create,
  list,
  read,
  readAll,
  readIssueOrThrow,
  readOutlineOrThrow,
  remove,
} from "../services/issues.js";
import { patchIssue } from "../services/root-merge-settings.js";
import {
  appendThreadEvent,
  setThreadInclusion,
} from "../services/thread-events.js";
import {
  onQuestionComment,
  retryQuestionResearcher,
} from "../services/question-researcher.js";
import { editComment } from "../services/comment-edit.js";
import { enrichCommentsForRead } from "../services/researcher-runs.js";
import {
  clearWorkQueueFields,
  createIssueChannelSession,
  startFirstPrompt,
} from "../services/conversations.js";
import {
  appendUpdateFromMergeBase,
  UPDATE_FROM_MERGE_BASE_NO_BRANCH_ERROR,
  UPDATE_FROM_MERGE_BASE_NO_MERGE_BASE_ERROR,
  UPDATE_FROM_MERGE_BASE_OPEN_TASK_ERROR,
} from "../services/merge-base-task.js";
import { moveStory } from "../services/move-story.js";
import { APPEND_TO_MERGED_ERROR } from "../services/patch.js";
import { requireProjectWorkspace } from "../services/project-workspace.js";
import { findPlanningWorkRoot } from "../services/planning-work-root.js";
import { readIssueChange, readIssueChangeFile } from "../services/change.js";
import {
  outlineVersionBody,
  outlineVersionDiff,
  parseOutlineVersion,
} from "../services/outline-body.js";
import {
  parseDecomposeRequest,
  startOutlinePlanningSession,
} from "../services/outline-planning-session.js";
import {
  discardOutlineDraft,
  parseOutlineDraftBody,
  parseOutlineDraftUpdate,
  publishOutlineDraft,
  setOutlineDraft,
} from "../services/outline-draft.js";
import { reorderBoardChild } from "../services/reorder-board.js";
import {
  applyArchivedListQuery,
  parseArchivedListQuery,
} from "../services/archived-list.js";
import { ancestorChain } from "../services/subtree.js";
import {
  removeStoryWorktree,
  setupStoryWorktree,
} from "../services/worktree.js";
import { dequeueWorkRoot } from "../services/dequeue-work-root.js";
import { enqueueWorkRoot } from "../services/enqueue-work-root.js";
import { parkWorkRoot } from "../services/park-work-root.js";
import { reorderQueuePosition } from "../services/reorder-queue-position.js";
import { resumeParkedWorkRoot } from "../services/resume-work-root.js";

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

function outlineServiceError(error: unknown): never {
  if (error instanceof IssueError) throw error;
  throw new IssueError(
    "validation",
    error instanceof Error ? error.message : String(error),
  );
}

function outlineVersionQuery(raw: unknown, name: string): number {
  if (typeof raw !== "string" || raw === "") {
    throw new IssueError("validation", `${name} is required`);
  }
  try {
    return parseOutlineVersion(raw);
  } catch (error) {
    outlineServiceError(error);
  }
}

export function createIssuesRouter(
  sessions: AgentSessions = agentSessions,
): Router {
  const router = Router();

  router.get(
    "/",
    asyncRoute((req, res) => {
      res.json(
        applyArchivedListQuery(list(), parseArchivedListQuery(req.query.archived)),
      );
    }),
  );

  router.get(
    "/:id",
    asyncRoute((req, res) => {
      res.json(read(req.params.id));
    }),
  );

  router.get(
    "/:id/outline/body",
    asyncRoute((req, res) => {
      const issue = readOutlineOrThrow(req.params.id);
      const version = outlineVersionQuery(req.query.version, "version");
      let body: string;
      try {
        body = outlineVersionBody(issue.id, issue.bodyVersion, version);
      } catch (error) {
        outlineServiceError(error);
      }
      res.json({ version, body });
    }),
  );

  router.get(
    "/:id/outline/diff",
    asyncRoute((req, res) => {
      const issue = readOutlineOrThrow(req.params.id);
      const from = outlineVersionQuery(req.query.from, "from");
      const to = outlineVersionQuery(req.query.to, "to");
      let diff: string;
      try {
        diff = outlineVersionDiff(issue.id, issue.bodyVersion, from, to);
      } catch (error) {
        outlineServiceError(error);
      }
      res.json({ from, to, diff });
    }),
  );

  router.post(
    "/:id/outline/decompose",
    asyncRoute(async (req, res) => {
      const outline = readOutlineOrThrow(req.params.id);
      const executionGate = parseDecomposeRequest(req.body);
      requireProjectWorkspace(outline.partOf);
      const meta = await startOutlinePlanningSession(
        {
          outlineId: outline.id,
          role: "decomposer",
          version: outline.bodyVersion,
          executionGate,
        },
        sessions,
      );
      res.status(201).json({
        id: meta.id,
        title: meta.title,
        model: meta.model,
      });
    }),
  );

  router.put(
    "/:id/outline-draft",
    asyncRoute(async (req, res) => {
      const body = parseOutlineDraftBody(req.body);
      await setOutlineDraft(req.params.id, body);
      res.json({ body });
    }),
  );

  router.post(
    "/:id/outline-draft/update",
    asyncRoute(async (req, res) => {
      const input = parseOutlineDraftUpdate(req.body);
      const published = await publishOutlineDraft(
        req.params.id,
        input,
        sessions,
      );
      res.status(201).json({
        id: published.meta.id,
        title: published.meta.title,
        model: published.meta.model,
        version: published.version,
      });
    }),
  );

  router.delete(
    "/:id/outline-draft",
    asyncRoute(async (req, res) => {
      await discardOutlineDraft(req.params.id);
      res.status(204).end();
    }),
  );

  router.get(
    "/:id/comments",
    asyncRoute(async (req, res) => {
      res.json(await enrichCommentsForRead(req.params.id));
    }),
  );

  router.get(
    "/:id/change",
    asyncRoute(async (req, res) => {
      res.json(await readIssueChange(req.params.id));
    }),
  );

  router.get(
    "/:id/change/file",
    asyncRoute(async (req, res) => {
      const path = req.query.path;
      const sha = req.query.sha;
      if (typeof path !== "string" || !path) {
        throw new IssueError("validation", "path is required");
      }
      if (typeof sha !== "string" || !sha) {
        throw new IssueError("validation", "sha is required");
      }
      res.json(await readIssueChangeFile(req.params.id, sha, path));
    }),
  );

  router.get(
    "/:id/agent-runs",
    asyncRoute((req, res) => {
      const issueId = req.params.id;
      const { issues } = readAll();
      if (!issues.some((item) => item.id === issueId)) readIssueOrThrow(issueId);
      const workRoot = findAgentRunsWorkRoot(issueId, issues);
      res.json({
        runs: listAgentRunsForIssue(issueId, issues),
        ...(workRoot ? { workRoot } : {}),
      });
    }),
  );

  router.get(
    "/:id/agent-runs/:delegationId/events",
    asyncRoute((req, res) => {
      const issueId = req.params.id;
      const delegationId = req.params.delegationId;
      readIssueOrThrow(issueId);
      const events = listAgentRunEvents(issueId, delegationId);
      if (!events) {
        throw new IssueError(
          "not_found",
          `unknown agent run "${delegationId}"`,
        );
      }
      res.json({ events });
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

  router.post(
    "/:id/queue",
    asyncRoute(async (req, res) => {
      res.json(await enqueueWorkRoot(req.params.id, sessions));
    }),
  );

  router.delete(
    "/:id/queue",
    asyncRoute(async (req, res) => {
      res.json(await dequeueWorkRoot(req.params.id));
    }),
  );

  router.post(
    "/:id/queue/park",
    asyncRoute(async (req, res) => {
      res.json(await parkWorkRoot(req.params.id, sessions));
    }),
  );

  router.post(
    "/:id/queue/resume",
    asyncRoute(async (req, res) => {
      const note = (req.body as { note?: unknown } | undefined)?.note;
      if (note !== undefined && typeof note !== "string") {
        throw new IssueError("validation", "note must be a string");
      }
      res.json(
        await resumeParkedWorkRoot(req.params.id, sessions, note?.trim() || undefined),
      );
    }),
  );

  router.put(
    "/:id/queue/position",
    asyncRoute(async (req, res) => {
      const index = (req.body as { index?: unknown } | undefined)?.index;
      if (typeof index !== "number" || !Number.isInteger(index)) {
        throw new IssueError("validation", "index must be an integer");
      }
      res.json(await reorderQueuePosition(req.params.id, index));
    }),
  );

  router.post(
    "/:id/channels/:channel/sessions",
    asyncRoute(async (req, res) => {
      const issueId = req.params.id;
      const issue = readIssueOrThrow(issueId);
      const channel = parseChannelParam(req.params.channel);
      if (
        channel === "planning" &&
        issue.kind === "idea" &&
        issue.outlineGate === true &&
        !issue.stakeholder
      ) {
        throw new IssueError(
          "conflict",
          'outlineGate is set but this Idea has no stakeholder; outlineGate governs auto-plan only',
        );
      }
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

      const { meta: created, firstPrompt } = await createIssueChannelSession(
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
      const started = firstPrompt
        ? await startFirstPrompt(created.id, firstPrompt, sessions)
        : undefined;
      if (channel === "implementing") {
        await clearWorkQueueFields(issueId);
      }
      if (started && !started.ok) {
        res.status(502).json({ error: started.message });
        return;
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
      const replace = req.query.replace === "true";
      const { meta, created } = await postAttachment(
        req.params.id,
        name,
        file.buffer,
        { replace },
      );
      res.status(created ? 201 : 200).json(meta);
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

  router.patch(
    "/:id/comments/:commentId",
    asyncRoute(async (req, res) => {
      const message = await editComment(
        req.params.id,
        req.params.commentId,
        req.body,
        { role: "human" },
      );
      res.json(message);
    }),
  );

  router.post(
    "/:id/comments",
    asyncRoute(async (req, res) => {
      const issueId = req.params.id;
      const message = await appendComment(issueId, req.body as CommentInput);
      const projectId = projectIdForIssue(issueId);
      res.status(201).json(message);
      // A failed launch shows on the thread's researcher state, not on this response.
      onQuestionComment(issueId, message, projectId, sessions).catch((err: unknown) => {
        console.error(`researcher launch failed for comment ${message.id}:`, err);
      });
    }),
  );

  router.post(
    "/:id/threads/:threadId/researcher/retry",
    asyncRoute(async (req, res) => {
      await retryQuestionResearcher(
        req.params.id,
        req.params.threadId,
        projectIdForIssue(req.params.id),
        sessions,
      );
      res.status(204).end();
    }),
  );

  router.post(
    "/:id/threads/:threadId/events",
    asyncRoute(async (req, res) => {
      const parsed = threadEventRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new IssueError(
          "validation",
          formatZodError(parsed.error, "invalid thread event"),
        );
      }
      const by = {
        role: "human" as const,
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      };
      const setsInclusion = isInclusionThreadEvent(parsed.data.event);
      const result = setsInclusion
        ? await setThreadInclusion(
            req.params.id,
            req.params.threadId,
            parsed.data.event === "included",
            by,
          )
        : await appendThreadEvent(req.params.id, req.params.threadId, {
            event: parsed.data.event,
            ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
            by,
          });
      res.status(201).json(result);
    }),
  );

  router.post(
    "/:id/update-from-merge-base",
    asyncRoute(async (req, res) => {
      const storyId = req.params.id;
      try {
        const summary = await appendUpdateFromMergeBase(storyId);
        const taskId = summary.created[0];
        if (!taskId) {
          throw new IssueError(
            "conflict",
            "update-from-merge-base created no task",
          );
        }
        res.status(201).json(read(taskId));
      } catch (err) {
        if (err instanceof IssueError && err.code === "validation") {
          const msg = err.message;
          if (
            msg === APPEND_TO_MERGED_ERROR(storyId) ||
            msg === UPDATE_FROM_MERGE_BASE_NO_BRANCH_ERROR(storyId) ||
            msg === UPDATE_FROM_MERGE_BASE_NO_MERGE_BASE_ERROR(storyId) ||
            msg === UPDATE_FROM_MERGE_BASE_OPEN_TASK_ERROR(storyId)
          ) {
            res.status(409).json({ error: msg });
            return;
          }
        }
        throw err;
      }
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
    "/:id/worktree/remove",
    asyncRoute(async (req, res) => {
      const storyId = req.params.id;
      const issue = readIssueOrThrow(storyId);
      if (issue.kind !== "story") {
        throw new IssueError("validation", `issue "${storyId}" is not a Story`);
      }
      const body = req.body as { discard?: unknown };
      const discard = body.discard === true;
      await removeStoryWorktree(storyId, { discard });
      res.status(204).end();
    }),
  );

  router.post(
    "/:id/worktree/setup",
    asyncRoute(async (req, res) => {
      const storyId = req.params.id;
      const issue = readIssueOrThrow(storyId);
      if (issue.kind !== "story") {
        throw new IssueError("validation", `issue "${storyId}" is not a Story`);
      }
      await setupStoryWorktree(storyId);
      res.status(204).end();
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
      const record = await patchIssue(req.params.id, req.body as IssuePatch);
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

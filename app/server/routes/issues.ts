import { Router, type RequestHandler } from "express";
import { basename } from "path";
import { uploadAttachment } from "../middleware/upload-attachment.js";
import {
  getAttachment,
  listAttachments,
  putAttachment,
  removeAttachment,
} from "../services/attachments.js";
import { IssueError } from "../services/errors.js";
import {
  appendMessage,
  create,
  list,
  read,
  readChat,
  remove,
  update,
} from "../services/issues.js";
import { moveStory } from "../services/move-story.js";
import { reorderBoardChild } from "../services/reorder-board.js";
import type {
  ChatMessageInput,
  CreateInput,
  IssuePatch,
} from "../schemas.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export const issuesRouter = Router();

issuesRouter.get("/", (_req, res) => {
  res.json(list());
});

issuesRouter.get(
  "/:id",
  asyncRoute((req, res) => {
    res.json(read(req.params.id));
  }),
);

issuesRouter.get(
  "/:id/chat",
  asyncRoute((req, res) => {
    res.json(readChat(req.params.id));
  }),
);

issuesRouter.get(
  "/:id/attachments",
  asyncRoute((req, res) => {
    res.json(listAttachments(req.params.id));
  }),
);

issuesRouter.post(
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

issuesRouter.get(
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

issuesRouter.delete(
  "/:id/attachments/:name",
  asyncRoute(async (req, res) => {
    await removeAttachment(req.params.id, req.params.name);
    res.status(204).end();
  }),
);

issuesRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const record = await create(req.body as CreateInput);
    res.status(201).json(record);
  }),
);

issuesRouter.post(
  "/:id/messages",
  asyncRoute(async (req, res) => {
    const message = await appendMessage(req.params.id, req.body as ChatMessageInput);
    res.status(201).json(message);
  }),
);

issuesRouter.post(
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

issuesRouter.post(
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

issuesRouter.patch(
  "/:id",
  asyncRoute(async (req, res) => {
    const record = await update(req.params.id, req.body as IssuePatch);
    res.json(record);
  }),
);

issuesRouter.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    const result = await remove(req.params.id);
    res.json(result);
  }),
);

import { Router, type RequestHandler } from "express";
import { getWorkspaceFile } from "../services/project-workspace.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export const projectsRouter = Router();

projectsRouter.get(
  "/:projectId/workspace/:relativePath(*)",
  asyncRoute((req, res) => {
    const { bytes, mime: contentType } = getWorkspaceFile(
      req.params.projectId,
      req.params.relativePath,
    );
    res.type(contentType);
    res.send(bytes);
  }),
);

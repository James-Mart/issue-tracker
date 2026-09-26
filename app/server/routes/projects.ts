import { Router, type RequestHandler } from "express";
import { readProjectPrs } from "../services/delivery.js";
import { IssueError } from "../services/errors.js";
import { readIssueOrThrow } from "../services/issues.js";
import { getWorkspaceFile } from "../services/project-workspace.js";
import { listSecretKeys } from "../services/secret-store.js";

const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

export const projectsRouter = Router();

projectsRouter.get(
  "/:projectId/prs",
  asyncRoute(async (req, res) => {
    const body = await readProjectPrs(req.params.projectId);
    res.json(body);
  }),
);

projectsRouter.get(
  "/:projectId/secrets",
  asyncRoute((req, res) => {
    const issue = readIssueOrThrow(req.params.projectId);
    if (issue.kind !== "project") {
      throw new IssueError(
        "not_found",
        `unknown project "${req.params.projectId}"`,
      );
    }
    res.json({ keys: listSecretKeys(issue.id) });
  }),
);

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

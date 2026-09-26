import { Router, type RequestHandler } from "express";
import { readProjectPrs } from "../services/delivery.js";
import { IssueError } from "../services/errors.js";
import { readIssueOrThrow } from "../services/issues.js";
import { getWorkspaceFile } from "../services/project-workspace.js";
import {
  deleteSecret,
  listSecretKeys,
  setSecret,
} from "../services/secret-store.js";

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

function requireProject(projectId: string): string {
  const issue = readIssueOrThrow(projectId);
  if (issue.kind !== "project") {
    throw new IssueError("not_found", `unknown project "${projectId}"`);
  }
  return issue.id;
}

function secretKeyList(projectId: string): { keys: string[] } {
  return { keys: listSecretKeys(projectId) };
}

function readSecretValue(body: unknown): string {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as { value?: unknown }).value !== "string"
  ) {
    throw new IssueError("validation", "body must be { value: string }");
  }
  return (body as { value: string }).value;
}

/** Map a secret-store key rejection to 400. Other store failures stay loud. */
function callSecretStore(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("invalid secret key ")) {
      throw new IssueError("validation", err.message);
    }
    throw err;
  }
}

projectsRouter.get(
  "/:projectId/secrets",
  asyncRoute((req, res) => {
    const projectId = requireProject(req.params.projectId);
    res.json(secretKeyList(projectId));
  }),
);

projectsRouter.put(
  "/:projectId/secrets/:key",
  asyncRoute((req, res) => {
    const projectId = requireProject(req.params.projectId);
    const value = readSecretValue(req.body);
    callSecretStore(() => setSecret(projectId, req.params.key, value));
    res.json(secretKeyList(projectId));
  }),
);

projectsRouter.delete(
  "/:projectId/secrets/:key",
  asyncRoute((req, res) => {
    const projectId = requireProject(req.params.projectId);
    callSecretStore(() => deleteSecret(projectId, req.params.key));
    res.json(secretKeyList(projectId));
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

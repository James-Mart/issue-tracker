import { existsSync, readFileSync, statSync } from "fs";
import mime from "mime";
import { isAbsolute, join, resolve, sep } from "path";
import type { IssuePatch } from "../schemas.js";
import { IssueError } from "./errors.js";

export function validateWorkspacePath(path: string): void {
  if (!path.trim()) {
    throw new IssueError("validation", "workspace path must be non-empty");
  }
  if (!isAbsolute(path)) {
    throw new IssueError("validation", "workspace path must be absolute");
  }
  if (!existsSync(path)) {
    throw new IssueError("validation", `workspace path does not exist: ${path}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new IssueError("validation", "workspace path must be a directory");
  }
  if (!existsSync(join(path, ".git"))) {
    throw new IssueError(
      "validation",
      "workspace path must contain a .git directory or file",
    );
  }
}

export function validateWorkspacePatch(patch: IssuePatch): void {
  if (!("workspace" in patch)) return;
  const { workspace } = patch;
  if (workspace !== null && workspace !== undefined) {
    validateWorkspacePath(workspace);
  }
}

export function assertSafeWorkspaceRelPath(relPath: string): void {
  if (!relPath.trim()) {
    throw new IssueError(
      "validation",
      "workspace-relative path must be non-empty",
    );
  }
  if (isAbsolute(relPath)) {
    throw new IssueError(
      "validation",
      "workspace-relative path must be relative",
    );
  }
  const parts = relPath.split(/[/\\]/);
  if (parts.some((part) => part === ".." || part === "")) {
    throw new IssueError(
      "validation",
      'workspace-relative path must not contain ".." or empty segments',
    );
  }
}

export function resolveUnderWorkspace(workspace: string, relPath: string): string {
  assertSafeWorkspaceRelPath(relPath);
  const root = resolve(workspace);
  const resolved = resolve(root, relPath);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new IssueError(
      "validation",
      "workspace-relative path escapes the Project workspace",
    );
  }
  return resolved;
}

export interface WorkspaceFileBytes {
  mime: string;
  bytes: Buffer;
}

export function readWorkspaceFile(
  workspace: string,
  relativePath: string,
): WorkspaceFileBytes {
  const resolved = resolveUnderWorkspace(workspace, relativePath);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new IssueError(
      "not_found",
      `workspace file not found: ${relativePath}`,
    );
  }
  return {
    mime: mime.lookup(relativePath) || "application/octet-stream",
    bytes: readFileSync(resolved),
  };
}

import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { issuesDir } from "../config.js";
import { IssueError } from "./errors.js";
import { replaceFileAtomically } from "./issues-store-lock.js";

/** Sidecar for an outline's one pending draft. Absent when there is no draft. */
export function outlineDraftPath(id: string): string {
  return join(issuesDir, id, "draft.md");
}

/** Pending draft text, or `undefined` when the outline has none. */
export function readOutlineDraft(id: string): string | undefined {
  const path = outlineDraftPath(id);
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8");
}

export function writeOutlineDraft(id: string, body: string): void {
  const path = outlineDraftPath(id);
  mkdirSync(dirname(path), { recursive: true });
  replaceFileAtomically(path, body);
}

export function removeOutlineDraft(id: string): void {
  const path = outlineDraftPath(id);
  if (!existsSync(path)) {
    throw new IssueError("validation", `outline "${id}" has no pending draft`);
  }
  rmSync(path);
}

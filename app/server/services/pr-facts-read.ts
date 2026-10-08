import {
  readProjectPrs,
  type ProjectPrsResponse,
} from "./delivery.js";
import { IssueError } from "./errors.js";
import { readIssueOrThrow } from "./issues.js";
import {
  readPrFactsCache,
  replacePrFactsCache,
} from "./pr-facts-cache.js";
import {
  notePrSyncError,
  notePrSyncSuccess,
  prSyncStatus,
} from "./pr-sync-driver.js";

function requireProjectIssue(projectId: string): void {
  const project = readIssueOrThrow(projectId);
  if (project.kind !== "project") {
    throw new IssueError("not_found", `unknown issue "${projectId}"`);
  }
}

function withSync(projectId: string, prs: ProjectPrsResponse["prs"]): ProjectPrsResponse {
  return { prs, sync: prSyncStatus(projectId) };
}

/** Last-pass cache and sync status. Does not call GitHub. */
export function cachedProjectPrs(projectId: string): ProjectPrsResponse {
  requireProjectIssue(projectId);
  return withSync(projectId, readPrFactsCache(projectId));
}

/**
 * Live GitHub read of every Story `prUrl` in the Project.
 * Replaces the cache and tells subscribers the pass data changed.
 */
export async function refreshProjectPrFacts(
  projectId: string,
): Promise<ProjectPrsResponse> {
  const live = await readProjectPrs(projectId);
  replacePrFactsCache(projectId, live.prs);
  notePrSyncSuccess(projectId);
  return withSync(projectId, live.prs);
}

/**
 * Live refresh after the tracker merges or records a PR.
 * A failed read is the Project's sync error; the write that triggered it stands.
 */
export async function refreshRecordedPrFacts(projectId: string): Promise<void> {
  try {
    await refreshProjectPrFacts(projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notePrSyncError(projectId, message);
  }
}

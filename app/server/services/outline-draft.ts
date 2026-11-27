import { z } from "zod";
import {
  emptyBodySchema,
  formatZodError,
  type Issue,
  type OutlinePendingDraft,
} from "../schemas.js";
import { IssueError } from "./errors.js";
import {
  commitIssueBatch,
  readDescription,
  readOutlineOrThrow,
  serialize,
  type IssueWrite,
} from "./issues.js";
import { captureOutlineDirections, type OutlineCapture } from "./outline-captures.js";
import { liveReplayDirectionIds } from "./outline-attachments.js";
import { readDraftPredatedDirectionIds } from "./outline-draft-predated.js";
import {
  finishPublishedDraft,
  revertDraftMockups,
} from "./outline-draft-mockups.js";
import { withOutlineMockupsLock } from "./outline-mockup-store.js";
import {
  readOutlineDraft,
  removeOutlineDraft,
  writeOutlineDraft,
} from "./outline-draft-store.js";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;

const draftBodySchema = z
  .object({
    body: z.string(),
  })
  .strict();

/** Body of `POST /outline-draft/approve`. Unknown fields are refused. */
export function assertEmptyOutlineDraftApprove(body: unknown): void {
  const parsed = emptyBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid outline draft approve"),
    );
  }
}

/** Body of `PUT /outline-draft`. Unknown fields are refused. */
export function parseOutlineDraftBody(body: unknown): string {
  const parsed = draftBodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid outline draft"),
    );
  }
  return parsed.data.body;
}

/** Replace the open draft's text. The caller holds the store write. */
export function rewriteOutlineDraftBody(
  id: string,
  body: string,
): OutlinePendingDraft {
  const existing = readOutlineDraft(id);
  if (!existing) {
    throw new IssueError("validation", `outline "${id}" has no pending draft`);
  }
  const next = { ...existing, body };
  writeOutlineDraft(id, next);
  return next;
}

/** Drop the pending draft when `not-now` settles the gate. */
export async function removePendingDraftForNotNow(id: string): Promise<void> {
  readOutlineOrThrow(id);
  if (readOutlineDraft(id) === undefined) {
    throw new IssueError("validation", `outline "${id}" has no pending draft`);
  }
  await withOutlineMockupsLock(id, () =>
    serialize(() => {
      readOutlineOrThrow(id);
      revertDraftMockups(id);
      removeOutlineDraft(id);
    }),
  );
}

/** Rewrite the open draft's text. Refused when none is open. */
export function replaceOutlineDraft(
  id: string,
  body: string,
): Promise<OutlinePendingDraft> {
  return serialize(() => {
    readOutlineOrThrow(id);
    return rewriteOutlineDraftBody(id, body);
  });
}

/**
 * Capture packed directions when this draft recorded the ones that predated
 * it. `undefined` when that record is absent. An empty array means there
 * were no directions to capture; publish still drops backups. `fromPack`
 * restores the packed tree first, so a failed edit is not captured.
 */
export async function prepareDraftPublish(
  outlineId: string,
): Promise<OutlineCapture[] | undefined> {
  if (readDraftPredatedDirectionIds(outlineId) === undefined) return undefined;
  if (liveReplayDirectionIds(outlineId).length === 0) return [];
  return captureOutlineDirections(outlineId, { fromPack: true });
}

/** Hold the mockup lock around a publish that has mockup bookkeeping. */
export function withDraftPublishLock<T>(
  outlineId: string,
  captures: readonly OutlineCapture[] | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (captures === undefined) return fn();
  return withOutlineMockupsLock(outlineId, fn);
}

function withResolvedCaptures<T>(
  outlineId: string,
  captures: Promise<readonly OutlineCapture[] | undefined>,
  write: (captures: readonly OutlineCapture[] | undefined) => Promise<T>,
): Promise<T> {
  return captures.then((resolved) =>
    withDraftPublishLock(outlineId, resolved, () => write(resolved)),
  );
}

function withDraftPublish<T>(
  outlineId: string,
  write: (captures: readonly OutlineCapture[] | undefined) => Promise<T>,
): Promise<T> {
  return withResolvedCaptures(outlineId, prepareDraftPublish(outlineId), write);
}

/**
 * Save the pending draft as the next version without starting reconciliation.
 * Returns the new version.
 */
export async function saveOutlineDraftVersion(id: string): Promise<number> {
  return withDraftPublish(id, (captures) =>
    serialize(() => saveDraftAsVersion(readOutlineOrThrow(id), requireDraft(id), captures)),
  );
}

function requireDraft(id: string): string {
  const draft = readOutlineDraft(id);
  if (draft === undefined) {
    throw new IssueError("validation", `outline "${id}" has no pending draft`);
  }
  return draft.body;
}

function draftVersionWrite(
  outline: OutlineIssue,
  draft: string,
): IssueWrite & { issue: OutlineIssue } {
  if (draft === readDescription(outline.id)) {
    throw new IssueError(
      "validation",
      `outline "${outline.id}" draft matches the saved body`,
    );
  }
  const issue: OutlineIssue = { ...outline, updatedAt: new Date().toISOString() };
  return { issue, description: draft };
}

function saveDraftAsVersion(
  outline: OutlineIssue,
  draft: string,
  captures: readonly OutlineCapture[] | undefined,
): number {
  const write = draftVersionWrite(outline, draft);
  commitIssueBatch([write], []);
  finishPublishedDraft(outline.id, draft, captures);
  return write.issue.bodyVersion;
}

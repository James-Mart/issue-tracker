import { z } from "zod";
import {
  formatZodError,
  outlineChannelForRole,
  type ConversationMeta,
  type Issue,
} from "../schemas.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import { refuseIfChannelBusy } from "./conversations.js";
import { errorAfterCommit, IssueError } from "./errors.js";
import {
  commitIssueBatch,
  readAll,
  readDescription,
  readIdeaOrThrow,
  readIssueOrThrow,
  readOutlineOrThrow,
  serialize,
  type IssueWrite,
} from "./issues.js";
import { appendTargetOutlineId } from "./append-target.js";
import { adoptAppendDraftBundles, unarchivedAppendIdeaIds } from "./outline-draft-bundles.js";
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
import type { OutlineReconcileScope } from "../../src/features/issues/lib/outline-planning-launch.js";
import {
  readSourceIdeaOrThrow,
  startOutlinePlanningSession,
} from "./outline-planning-session.js";
import { requireProjectWorkspace } from "./project-workspace.js";

type OutlineIssue = Extract<Issue, { kind: "outline" }>;

const draftBodySchema = z
  .object({
    body: z.string(),
  })
  .strict();

const draftUpdateSchema = z
  .object({
    targetStory: z.string().optional(),
    coveredBy: z.array(z.string()).optional(),
    sourceIdea: z.string().optional(),
  })
  .strict();

export type OutlineDraftUpdate = z.infer<typeof draftUpdateSchema>;

export type PublishedOutlineDraft = {
  version: number;
  meta: ConversationMeta;
};

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

/** Body of `POST /outline-draft/update`. Unknown fields are refused. */
export function parseOutlineDraftUpdate(body: unknown): OutlineDraftUpdate {
  const parsed = draftUpdateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new IssueError(
      "validation",
      formatZodError(parsed.error, "invalid outline draft update"),
    );
  }
  return parsed.data;
}

/** Replace the outline's one pending draft. Does not add a version. */
export async function setOutlineDraft(id: string, body: string): Promise<void> {
  await serialize(() => {
    readOutlineOrThrow(id);
    writeOutlineDraft(id, body);
    adoptAppendDraftBundles(id);
  });
}

/** Drop the pending draft. An outline with none is an error. */
export async function discardOutlineDraft(id: string): Promise<void> {
  readOutlineOrThrow(id);
  if (readOutlineDraft(id) === undefined) {
    throw new IssueError("validation", `outline "${id}" has no pending draft`);
  }
  await withOutlineMockupsLock(id, () =>
    serialize(() => {
      readOutlineOrThrow(id);
      const { issues } = readAll();
      revertDraftMockups(id, unarchivedAppendIdeaIds(id, issues));
      removeOutlineDraft(id);
    }),
  );
}

/**
 * Capture packed directions when this draft recorded the ones that predated
 * it. `undefined` when that record is absent. An empty array means there
 * were no directions to capture; publish still drops backups. `fromPack`
 * restores the packed tree first, so a failed edit is not captured.
 */
export async function prepareAppendDraftPublish(
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

function withAppendDraftPublish<T>(
  outlineId: string,
  write: (captures: readonly OutlineCapture[] | undefined) => Promise<T>,
): Promise<T> {
  return withResolvedCaptures(outlineId, prepareAppendDraftPublish(outlineId), write);
}

/** Same publish lock as a direct draft publish, after conclude's append checks. */
export function withAppendConcludePublish<T>(
  ideaId: string,
  outlineId: string,
  write: (captures: readonly OutlineCapture[] | undefined) => Promise<T>,
): Promise<T> {
  return withResolvedCaptures(outlineId, capturesForAppendConclude(ideaId, outlineId), write);
}

async function capturesForAppendConclude(
  ideaId: string,
  outlineId: string,
): Promise<OutlineCapture[] | undefined> {
  const idea = readIdeaOrThrow(ideaId);
  if (idea.kind !== "idea" || idea.archived || !idea.appendTo) return undefined;
  const { issues } = readAll();
  if (appendTargetOutlineId(issues, idea.appendTo) !== outlineId) return undefined;
  if (readOutlineDraft(outlineId) === undefined) return undefined;
  return prepareAppendDraftPublish(outlineId);
}

/**
 * Save the pending draft as the next version and start reconciliation.
 * The busy check and the version write share one store turn so no outline
 * session can start between them. The session itself starts after that
 * turn; a failure there leaves the new version in place.
 */
export async function publishOutlineDraft(
  id: string,
  input: OutlineDraftUpdate,
  sessions: ConversationMessageSessions,
): Promise<PublishedOutlineDraft> {
  const prepared = await withAppendDraftPublish(id, (captures) =>
    serialize(() => {
      const outline = readOutlineOrThrow(id);
      const draft = requireDraft(id);
      const targetStory = resolveTargetStory(input.targetStory);
      const scope: OutlineReconcileScope = {
        targetStory,
        coveredBy: resolveCoveredBy(input.coveredBy),
        sourceIdea: resolveSourceIdea(input.sourceIdea, targetStory),
      };
      requireProjectWorkspace(outline.partOf);
      refuseIfChannelBusy(outline.id, outlineChannelForRole("reconcile"), sessions);
      const version = saveDraftAsVersion(outline, draft, captures);
      return { version, scope };
    }),
  );
  try {
    const meta = await startOutlinePlanningSession(
      {
        outlineId: id,
        role: "reconcile",
        version: prepared.version,
        ...prepared.scope,
      },
      sessions,
    );
    return { version: prepared.version, meta };
  } catch (error) {
    throw errorAfterCommit(
      error,
      `outline "${id}" was saved as version ${prepared.version}, but reconciliation did not start`,
    );
  }
}

/**
 * Save the pending draft as the next version without starting reconciliation.
 * Returns the new version.
 */
export async function saveOutlineDraftVersion(id: string): Promise<number> {
  return withAppendDraftPublish(id, (captures) =>
    serialize(() => saveDraftAsVersion(readOutlineOrThrow(id), requireDraft(id), captures)),
  );
}

function requireDraft(id: string): string {
  const draft = readOutlineDraft(id);
  if (draft === undefined) {
    throw new IssueError("validation", `outline "${id}" has no pending draft`);
  }
  return draft;
}

/**
 * The outline write that publishes the pending draft as the next version.
 * Caller holds issues `serialize()` and commits the write.
 */
export function pendingDraftVersionWrite(id: string): {
  write: IssueWrite & { issue: OutlineIssue };
  draft: string;
} {
  const outline = readOutlineOrThrow(id);
  const draft = requireDraft(id);
  return { write: draftVersionWrite(outline, draft), draft };
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

function resolveTargetStory(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const id = raw.trim();
  if (id === "") {
    throw new IssueError("validation", "target story is empty");
  }
  const issue = readIssueOrThrow(id);
  if (issue.kind !== "story") {
    throw new IssueError("validation", `target story "${id}" is not a story`);
  }
  return id;
}

function resolveCoveredBy(raw: string[] | undefined): string[] | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const part of raw) {
    const taskId = part.trim();
    if (taskId === "") {
      throw new IssueError("validation", "covered-by id is empty");
    }
    if (seen.has(taskId)) {
      throw new IssueError(
        "validation",
        `covered-by lists "${taskId}" more than once`,
      );
    }
    seen.add(taskId);
    const issue = readIssueOrThrow(taskId);
    if (issue.kind !== "task") {
      throw new IssueError(
        "validation",
        `covered-by "${taskId}" is not a task`,
      );
    }
    ids.push(taskId);
  }
  return ids;
}

function resolveSourceIdea(
  raw: string | undefined,
  targetStory: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const id = raw.trim();
  if (id === "") {
    throw new IssueError("validation", "source idea is empty");
  }
  if (targetStory === undefined) {
    throw new IssueError(
      "validation",
      "source idea requires a target story to receive its tasks",
    );
  }
  return readSourceIdeaOrThrow(id).id;
}


import { z } from "zod";
import { formatZodError, type ConversationMeta, type Issue } from "../schemas.js";
import type { ConversationMessageSessions } from "./conversation-message.js";
import {
  channelPredecessors,
  refuseIfPredecessorBusy,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import {
  commitIssueBatch,
  readDescription,
  readIssueOrThrow,
  readOutlineOrThrow,
  serialize,
} from "./issues.js";
import {
  readOutlineDraft,
  removeOutlineDraft,
  writeOutlineDraft,
} from "./outline-draft-store.js";
import { startOutlinePlanningSession } from "./outline-planning-session.js";
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
  })
  .strict();

export type OutlineDraftUpdate = {
  targetStory?: string;
  coveredBy?: string[];
};

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
  });
}

/** Drop the pending draft. An outline with none is an error. */
export async function discardOutlineDraft(id: string): Promise<void> {
  await serialize(() => {
    readOutlineOrThrow(id);
    removeOutlineDraft(id);
  });
}

/**
 * Save the pending draft as the next version and start reconciliation.
 * The busy check and the version write share one store turn so a planning
 * session cannot start between them. The session itself starts after that
 * turn; a failure there leaves the new version in place.
 */
export async function publishOutlineDraft(
  id: string,
  input: OutlineDraftUpdate,
  sessions: ConversationMessageSessions,
): Promise<PublishedOutlineDraft> {
  const prepared = await serialize(() => {
    const outline = readOutlineOrThrow(id);
    const draft = requireDraft(id);
    const targetStory = resolveTargetStory(input.targetStory);
    const coveredBy = resolveCoveredBy(input.coveredBy);
    requireProjectWorkspace(outline.partOf);
    refuseIfPredecessorBusy(
      outline.id,
      "planning",
      channelPredecessors(outline.id, "planning"),
      sessions,
    );
    const version = saveDraftAsVersion(outline, draft);
    return { version, targetStory, coveredBy };
  });
  try {
    const meta = await startOutlinePlanningSession(
      {
        outlineId: id,
        role: "reconcile",
        version: prepared.version,
        targetStory: prepared.targetStory,
        coveredBy: prepared.coveredBy,
      },
      sessions,
    );
    return { version: prepared.version, meta };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const code = error instanceof IssueError ? error.code : "validation";
    throw new IssueError(
      code,
      `outline "${id}" was saved as version ${prepared.version}, but reconciliation did not start: ${reason}`,
      error instanceof IssueError ? error.details : undefined,
    );
  }
}

/**
 * Save the pending draft as the next version without starting reconciliation.
 * Returns the new version.
 */
export async function saveOutlineDraftVersion(id: string): Promise<number> {
  return serialize(() => saveDraftAsVersion(readOutlineOrThrow(id), requireDraft(id)));
}

function requireDraft(id: string): string {
  const draft = readOutlineDraft(id);
  if (draft === undefined) {
    throw new IssueError("validation", `outline "${id}" has no pending draft`);
  }
  return draft;
}

function saveDraftAsVersion(outline: OutlineIssue, draft: string): number {
  if (draft === readDescription(outline.id)) {
    throw new IssueError(
      "validation",
      `outline "${outline.id}" draft matches the saved body`,
    );
  }
  const issue = { ...outline, updatedAt: new Date().toISOString() };
  commitIssueBatch([{ issue, description: draft }], []);
  if (readOutlineDraft(outline.id) === draft) removeOutlineDraft(outline.id);
  return issue.bodyVersion;
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


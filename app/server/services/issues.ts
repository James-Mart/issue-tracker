import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { issuesDir } from "../config.js";
import {
  kindCapabilityRefusal,
  kindHas,
  type RefuseableCapability,
} from "../kind.js";
import {
  parseChatMessage,
  parseChatMessageInput,
  parseIssue,
  requiresPartOf,
  type ChatMessage,
  type ChatMessageInput,
  type ChatResponse,
  type CreateInput,
  type Issue,
  type IssueDetail,
  type IssuePatch,
  type IssueRecord,
  type IssuesResponse,
  type Problem,
} from "../schemas.js";
import { IssueError } from "./errors.js";
import { nextSiblingOrder, siblingGroupKey } from "../order.js";
import { derive } from "./derive.js";
import { checkIntegrity, problemsFor } from "./integrity.js";
import { mergeIssue } from "./merge.js";
import {
  branchNameRenameError,
  ensureMergeBaseStripped,
} from "./merge-base.js";
import {
  ensureArchivedBackfilled,
  planArchivedCascade,
  type ArchivedCascadePatch,
} from "./archived.js";
import { ensureKindRenamed } from "./kind-rename.js";
import { ancestorIsArchived } from "./archived-visibility.js";
import { planDeletion, type DeletionResult } from "./deletion.js";
import { uniqueSlug } from "./slug.js";
import { validateNonClearablePatch } from "./patch.js";
import { validateCommitShaPatch } from "./commit-sha.js";
import { validateWorkspacePatch, validateWorkspacePath } from "./workspace.js";
import { validateSupportingDocsPatch } from "./supporting-docs.js";
import { validateInspirationAppsPatch } from "./inspiration-apps.js";
import {
  planLabelCatalogCascade,
  planLabelCatalogRename,
  singleCatalogIdRename,
  type LabelCascadePatch,
} from "./labels.js";

let writeChain: Promise<unknown> = Promise.resolve();

// Exported, with `readAll`/`readDescription`/`readIssueOrThrow`/
// `commitIssueBatch`, so sibling writers in the service layer (e.g. `apply`,
// attachments) can read the current graph or a single issue and commit a
// validated batch inside this same in-process write chain, and so cannot race
// HTTP/CLI writes. These five are the whole seam: the low-level FS primitives
// stay private to this module.
export function serialize<T>(fn: () => T): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function dirOf(id: string): string {
  return join(issuesDir, id);
}

function jsonPathOf(id: string): string {
  return join(dirOf(id), "issue.json");
}

function chatPathOf(id: string): string {
  return join(dirOf(id), "chat.jsonl");
}

function scanIds(): string[] {
  if (!existsSync(issuesDir)) return [];
  return readdirSync(issuesDir).filter((entry) =>
    statSync(dirOf(entry)).isDirectory(),
  );
}

function readRaw(id: string): {
  issue?: Issue;
  problem?: Problem;
  text?: string;
} {
  const jsonPath = jsonPathOf(id);
  if (!existsSync(jsonPath)) {
    return { problem: { id, message: "missing issue.json" } };
  }
  const text = readFileSync(jsonPath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { problem: { id, message: `invalid issue.json: ${detail}` }, text };
  }
  const parsed = parseIssue(raw);
  if (!parsed.ok) {
    return { problem: { id, message: parsed.message }, text };
  }
  if (parsed.issue.id !== id) {
    return {
      issue: { ...parsed.issue, id },
      problem: {
        id,
        message: `issue.json id "${parsed.issue.id}" does not match directory name`,
      },
      text,
    };
  }
  return { issue: parsed.issue, text };
}

function toRecord(issue: Issue): IssueRecord {
  return issue;
}

export function readAll(): { issues: Issue[]; problems: Problem[] } {
  const issues: Issue[] = [];
  const problems: Problem[] = [];
  for (const id of scanIds()) {
    const { issue, problem } = readRaw(id);
    if (issue) issues.push(issue);
    if (problem) problems.push(problem);
  }
  return { issues, problems };
}

// One-time mergeBase strip. Safe to call from list/create/apply; no-ops
// after the marker file exists.
export function ensureMergeBasesMigrated(): void {
  ensureMergeBaseStripped((story) => {
    persist(story, serializeIssue(story));
  });
}

// One-time archived migration. Safe to call from list/create/apply; no-ops
// after the marker file exists.
export function ensureArchivedMigrated(): void {
  ensureArchivedBackfilled((issue) => {
    persist(issue, serializeIssue(issue));
  });
}

/** Run every one-shot on-disk migration. Prefer this over calling each ensure* alone. */
export function ensureMigrations(): void {
  // Kind rename must run before parseIssue-based migrations (old kinds won't parse).
  ensureKindRenamed();
  ensureMergeBasesMigrated();
  ensureArchivedMigrated();
}

export function list(): IssuesResponse {
  ensureMigrations();
  const { issues, problems } = readAll();
  const derived = derive(issues);
  // Parse each chat.jsonl so out-of-band corruption surfaces in the tree/CLI,
  // not just the chat panel. Chats are small local files, so the extra reads
  // are cheap; list() is not invalidated on every chat append (see events).
  const chatProblems = issues.flatMap((issue) => readChat(issue.id).problems);
  return {
    issues: issues.map(toRecord),
    problems: [...problems, ...chatProblems, ...derived.problems],
    derived: derived.byId,
  };
}

export function readDescription(id: string): string {
  const path = join(dirOf(id), "description.md");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

// True when the on-disk issue.json carries keys the current schema no longer
// recognizes (e.g. a Branch's pre-migration `blockedBy`). `parseIssue` strips
// such keys on read, so a parsed issue never reflects them; comparing the raw
// top-level keys against the parsed issue's is the only way to see the drift.
// `apply` uses this so a re-apply reconciles stale fields off disk instead of
// treating a semantically-unchanged-but-stale file as a no-op.
export function onDiskHasUnknownKeys(issue: Issue): boolean {
  const path = jsonPathOf(issue.id);
  if (!existsSync(path)) return false;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  if (!raw || typeof raw !== "object") return false;
  const known = new Set(Object.keys(issue));
  return Object.keys(raw as Record<string, unknown>).some((key) => !known.has(key));
}

// The version covers issue.json + description.md, the two files the edit form
// mutates. chat.jsonl is excluded on purpose: append-only chat updates live
// through its own SSE-fed query and must not trip the external-edit banner.
export function versionOf(jsonText: string, description: string): string {
  return createHash("sha1")
    .update(jsonText)
    .update("\0")
    .update(description)
    .digest("hex");
}

function toDetail(issue: Issue, jsonText: string, description: string): IssueDetail {
  return {
    ...toRecord(issue),
    description,
    version: versionOf(jsonText, description),
  };
}

export function read(id: string): IssueDetail {
  // Surface post-migration fields on show/detail without requiring a prior list.
  ensureMigrations();
  if (!existsSync(dirOf(id))) {
    throw new IssueError("not_found", `unknown issue "${id}"`);
  }
  const { issue, problem, text } = readRaw(id);
  if (!issue || text === undefined) {
    throw new IssueError("validation", problem?.message ?? `invalid issue "${id}"`);
  }
  return toDetail(issue, text, readDescription(id));
}

export function readIssueOrThrow(id: string): Issue {
  if (!existsSync(dirOf(id))) {
    throw new IssueError("not_found", `unknown issue "${id}"`);
  }
  const { issue, problem } = readRaw(id);
  if (!issue) {
    throw new IssueError("validation", problem?.message ?? `invalid issue "${id}"`);
  }
  return issue;
}

export function requireKindCapability(
  id: string,
  capability: RefuseableCapability,
): Issue {
  const issue = readIssueOrThrow(id);
  if (!kindHas(issue.kind, capability)) {
    throw new IssueError(
      "validation",
      kindCapabilityRefusal(issue.kind, capability),
    );
  }
  return issue;
}

function serializeIssue(issue: Issue): string {
  return `${JSON.stringify(issue, null, 2)}\n`;
}

function persist(issue: Issue, jsonText: string): void {
  const dir = dirOf(issue.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(jsonPathOf(issue.id), jsonText);
}

// A single issue to (re)write: its parsed record plus, when provided, the
// description.md body to overwrite. An `undefined` description leaves any
// existing description.md untouched.
export interface IssueWrite {
  issue: Issue;
  description?: string;
}

// Commit a validated batch of issue writes and directory deletions in one shot.
// This keeps the raw filesystem layout (issue.json / description.md paths and
// recursive directory removal) private to this module, so sibling writers like
// `apply` stay off the low-level `persist`/`dirOf`/`rmSync` primitives and there
// is still exactly one place that touches issue storage. Callers must run this
// inside `serialize`, and only after the whole prospective set has passed
// `checkIntegrity` — this function performs no validation of its own.
export function commitIssueBatch(writes: IssueWrite[], deletes: string[]): void {
  for (const { issue, description } of writes) {
    persist(issue, serializeIssue(issue));
    if (description !== undefined) {
      writeFileSync(join(dirOf(issue.id), "description.md"), description);
    }
  }
  for (const id of deletes) {
    rmSync(dirOf(id), { recursive: true, force: true });
  }
}

function assertWritable(target: Issue, all: Issue[]): void {
  const others = all.filter((issue) => issue.id !== target.id);
  const problems = problemsFor(target.id, [...others, target]);
  if (problems.length > 0) {
    throw new IssueError("validation", problems.map((p) => p.message).join("; "));
  }
}

export function create(input: CreateInput): Promise<IssueRecord> {
  return serialize(() => {
    ensureMigrations();
    const title = input.title?.trim();
    if (!title) throw new IssueError("validation", "title is required");

    const { issues } = readAll();
    const id = uniqueSlug(
      title,
      issues.map((issue) => issue.id),
    );
    const now = new Date().toISOString();

    const draft: Record<string, unknown> = {
      id,
      kind: input.kind,
      title,
      order: nextSiblingOrder(
        issues,
        input.kind,
        input.partOf,
        input.stackedOn,
      ),
      createdAt: now,
      updatedAt: now,
    };
    // Kind-gated defaults via KIND_CAPABILITIES (not project/idea special-cases).
    if (kindHas(input.kind, "attention")) {
      draft.needsAttention = false;
      draft.attentionReason = null;
    }
    if (kindHas(input.kind, "assignee") && input.assignee) {
      draft.assignee = input.assignee;
    }
    if (kindHas(input.kind, "archived")) {
      draft.archived = ancestorIsArchived(input.partOf, issues);
    }
    if (requiresPartOf(input.kind)) {
      if (!input.partOf) {
        throw new IssueError(
          "validation",
          `a ${input.kind} must have a partOf parent`,
        );
      }
      draft.partOf = input.partOf;
    }
    if (input.kind === "epic") draft.blockedBy = [];
    if (input.kind === "story") {
      draft.merged = false;
      if (input.stackedOn) draft.stackedOn = input.stackedOn;
    }
    if (input.kind === "task") draft.status = "todo";
    if (input.kind === "project") {
      if (input.workspace) {
        validateWorkspacePath(input.workspace);
        draft.workspace = input.workspace;
      }
      if (input.mergePolicy) draft.mergePolicy = input.mergePolicy;
    }

    const parsed = parseIssue(draft);
    if (!parsed.ok) throw new IssueError("validation", parsed.message);

    assertWritable(parsed.issue, issues);
    persist(parsed.issue, serializeIssue(parsed.issue));
    writeFileSync(
      join(dirOf(id), "description.md"),
      input.description ?? `# ${title}\n`,
    );
    return toRecord(parsed.issue);
  });
}

/** Group planned cascade field patches by child and apply one merged write each. */
function applyCascadePatches(
  archivedPatches: ArchivedCascadePatch[],
  labelPatches: LabelCascadePatch[],
  issues: Issue[],
  now: string,
): Issue[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const patchesById = new Map<string, IssuePatch>();

  for (const { id: childId, archived } of archivedPatches) {
    const prior = patchesById.get(childId) ?? {};
    patchesById.set(childId, { ...prior, archived });
  }
  for (const { id: childId, labels } of labelPatches) {
    const prior = patchesById.get(childId) ?? {};
    patchesById.set(childId, { ...prior, labels });
  }

  const cascaded: Issue[] = [];
  for (const [childId, patch] of patchesById) {
    const child = byId.get(childId);
    if (!child) {
      throw new IssueError(
        "validation",
        `cascade target "${childId}" is missing`,
      );
    }
    if (patch.archived !== undefined && child.kind === "project") {
      throw new IssueError(
        "validation",
        `archived cascade target "${childId}" is missing or not archivable`,
      );
    }
    if (
      patch.labels !== undefined &&
      child.kind !== "epic" &&
      child.kind !== "idea" &&
      child.kind !== "story"
    ) {
      throw new IssueError(
        "validation",
        `label cascade target "${childId}" is missing or not assignable`,
      );
    }
    const childParsed = parseIssue(mergeIssue(child, patch));
    if (!childParsed.ok) {
      throw new IssueError("validation", childParsed.message);
    }
    childParsed.issue.updatedAt = now;
    cascaded.push(childParsed.issue);
  }
  return cascaded;
}

/**
 * Rename a Project catalog label id and rewrite matching assignments in the
 * same write. Refuses when `newId` already exists or is not kebab-safe.
 */
export function renameProjectLabel(
  projectId: string,
  oldId: string,
  newId: string,
): Promise<IssueDetail> {
  return serialize(() => {
    const existing = readIssueOrThrow(projectId);
    if (existing.kind !== "project") {
      throw new IssueError(
        "validation",
        `"${projectId}" is not a project`,
      );
    }
    const { issues } = readAll();
    const { projectLabels, assignmentPatches } = planLabelCatalogRename(
      existing,
      oldId,
      newId,
      issues,
    );

    const projectParsed = parseIssue(
      mergeIssue(existing, { labels: projectLabels }),
    );
    if (!projectParsed.ok) {
      throw new IssueError("validation", projectParsed.message);
    }

    const now = new Date().toISOString();
    projectParsed.issue.updatedAt = now;
    const cascaded = applyCascadePatches([], assignmentPatches, issues, now);

    const writes: IssueWrite[] = [
      { issue: projectParsed.issue },
      ...cascaded.map((issue) => ({ issue })),
    ];
    const prospective = new Map(issues.map((issue) => [issue.id, issue]));
    for (const write of writes) {
      prospective.set(write.issue.id, write.issue);
    }
    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((p) => p.message).join("; "),
      );
    }

    commitIssueBatch(writes, []);
    const jsonText = serializeIssue(projectParsed.issue);
    return toDetail(projectParsed.issue, jsonText, readDescription(projectId));
  });
}

export function update(id: string, patch: IssuePatch): Promise<IssueDetail> {
  return serialize(() => {
    const existing = readIssueOrThrow(id);
    const { issues } = readAll();

    const { description, ...jsonPatch } = patch;
    validateWorkspacePatch(jsonPatch);
    validateSupportingDocsPatch(existing, jsonPatch);
    validateInspirationAppsPatch(existing, jsonPatch);
    validateCommitShaPatch(jsonPatch);
    validateNonClearablePatch(jsonPatch);

    const renameError = branchNameRenameError(existing, jsonPatch, issues);
    if (renameError) throw new IssueError("validation", renameError);

    const merged = mergeIssue(existing, jsonPatch);

    const parsed = parseIssue(merged);
    if (!parsed.ok) throw new IssueError("validation", parsed.message);

    const stripped = Object.keys(merged).filter(
      (key) => !(key in parsed.issue),
    );
    if (stripped.length > 0) {
      throw new IssueError(
        "validation",
        `field(s) not valid for a ${existing.kind}: ${stripped.join(", ")}`,
      );
    }

    // Moving a node to a new sibling group (a reparent via `partOf`, or a Branch
    // restack/unstack via `stackedOn`) can leave its old `order` colliding in the
    // new group; re-append there unless the caller set `order` explicitly. Keyed
    // off the one `siblingGroupKey` definition so it stays in lockstep with the
    // integrity duplicate-order check. This runs before the no-op check, but a
    // group change already makes the issue differ, so the unchanged path is safe.
    const next = parsed.issue;
    const orderPatched = "order" in jsonPatch;
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    if (
      !orderPatched &&
      siblingGroupKey(next, byId) !== siblingGroupKey(existing, byId)
    ) {
      const partOf = "partOf" in next ? next.partOf : undefined;
      const stackedOn = next.kind === "story" ? next.stackedOn : undefined;
      next.order = nextSiblingOrder(issues, next.kind, partOf, stackedOn, id);
    }

    const archivedCascadePatches = planArchivedCascade(
      existing,
      jsonPatch,
      issues,
    );
    const catalogRename =
      existing.kind === "project" && next.kind === "project"
        ? singleCatalogIdRename(existing, next)
        : null;
    const labelCascadePatches = catalogRename
      ? planLabelCatalogRename(
          existing,
          catalogRename.oldId,
          catalogRename.newId,
          issues,
        ).assignmentPatches
      : planLabelCatalogCascade(existing, next, issues);

    const jsonUnchanged =
      JSON.stringify(parsed.issue) === JSON.stringify(existing);
    if (
      jsonUnchanged &&
      archivedCascadePatches.length === 0 &&
      labelCascadePatches.length === 0 &&
      description === undefined
    ) {
      return read(id);
    }

    const now = new Date().toISOString();
    const cascaded = applyCascadePatches(
      archivedCascadePatches,
      labelCascadePatches,
      issues,
      now,
    );

    const writes: IssueWrite[] = [];
    if (!jsonUnchanged || description !== undefined) {
      parsed.issue.updatedAt = now;
      writes.push({ issue: parsed.issue, description });
    }
    for (const child of cascaded) {
      writes.push({ issue: child });
    }

    if (cascaded.length === 0) {
      // Single-node write: keep the historical scoped check so unrelated
      // pre-existing integrity problems do not block this update.
      assertWritable(parsed.issue, issues);
    } else {
      const prospective = new Map(issues.map((issue) => [issue.id, issue]));
      for (const write of writes) {
        prospective.set(write.issue.id, write.issue);
      }
      // Parent may be unchanged (idempotent set-merged) — still include it so
      // cascade targets are validated against the post-write parent state.
      prospective.set(parsed.issue.id, parsed.issue);
      const problems = checkIntegrity([...prospective.values()]);
      if (problems.length > 0) {
        throw new IssueError(
          "validation",
          problems.map((p) => p.message).join("; "),
        );
      }
    }

    commitIssueBatch(writes, []);
    const jsonText = serializeIssue(parsed.issue);
    const finalDescription =
      description !== undefined ? description : readDescription(id);
    return toDetail(parsed.issue, jsonText, finalDescription);
  });
}

export function readChat(id: string): ChatResponse {
  if (!existsSync(dirOf(id))) {
    throw new IssueError("not_found", `unknown issue "${id}"`);
  }
  const path = chatPathOf(id);
  if (!existsSync(path)) return { messages: [], problems: [] };

  const messages: ChatMessage[] = [];
  const problems: Problem[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      problems.push({ id, message: `chat.jsonl line ${index + 1}: ${detail}` });
      return;
    }
    const parsed = parseChatMessage(raw);
    if (parsed.ok) messages.push(parsed.message);
    else problems.push({ id, message: `chat.jsonl line ${index + 1}: ${parsed.message}` });
  });
  return { messages, problems };
}

export function appendMessage(
  id: string,
  input: ChatMessageInput,
): Promise<ChatMessage> {
  return serialize(() => {
    requireKindCapability(id, "chat");
    const parsed = parseChatMessageInput(input);
    if (!parsed.ok) throw new IssueError("validation", parsed.message);
    const message: ChatMessage = { ...parsed.input, at: new Date().toISOString() };
    appendFileSync(chatPathOf(id), `${JSON.stringify(message)}\n`);
    return message;
  });
}

// Deleting an issue removes the whole containment subtree (the issue plus every
// descendant `partOf` it) and repairs every surviving foreign reference into it:
// a branch stacked on a deleted branch is spliced to the deleted branch's own
// fork point, and deleted ids are dropped from any Epic's `blockedBy`. The
// prospective surviving set is validated before anything is written, so a
// deletion that could not leave the graph valid is refused without side effects.
export function remove(id: string): Promise<DeletionResult> {
  return serialize(() => {
    if (!existsSync(dirOf(id))) {
      throw new IssueError("not_found", `unknown issue "${id}"`);
    }

    const { issues } = readAll();
    const plan = planDeletion(issues, id);
    const deleteSet = new Set(plan.deleteIds);

    const patchOf = new Map<string, IssuePatch>();
    for (const { id: bid, to } of plan.repoint) {
      const patch = patchOf.get(bid) ?? {};
      patch.stackedOn = to ?? null;
      patchOf.set(bid, patch);
    }
    for (const { id: bid, blockedBy } of plan.unblock) {
      const patch = patchOf.get(bid) ?? {};
      patch.blockedBy = blockedBy;
      patchOf.set(bid, patch);
    }

    const now = new Date().toISOString();
    const survivors: Issue[] = [];
    const toPersist: Issue[] = [];
    for (const issue of issues) {
      if (deleteSet.has(issue.id)) continue;
      const patch = patchOf.get(issue.id);
      if (!patch) {
        survivors.push(issue);
        continue;
      }
      const parsed = parseIssue(mergeIssue(issue, patch));
      if (!parsed.ok) throw new IssueError("validation", parsed.message);
      parsed.issue.updatedAt = now;
      survivors.push(parsed.issue);
      toPersist.push(parsed.issue);
    }

    const problems = checkIntegrity(survivors);
    if (problems.length > 0) {
      throw new IssueError("validation", problems.map((p) => p.message).join("; "));
    }

    for (const issue of toPersist) persist(issue, serializeIssue(issue));
    for (const delId of plan.deleteIds) {
      rmSync(dirOf(delId), { recursive: true, force: true });
    }

    return {
      deleted: plan.deleteIds,
      repointed: plan.repoint,
      unblocked: plan.unblock,
    };
  });
}

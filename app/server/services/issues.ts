import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import {
  kindCapabilityRefusal,
  kindHas,
  type RefuseableCapability,
} from "../kind.js";
import {
  parseIssue,
  requiresPartOf,
  type CreateInput,
  type Issue,
  type IssueDetail,
  type IssuePatch,
  type IssueRecord,
  type IssuesResponse,
  type Problem,
  type ReviewIssue,
  type TaskStatus,
} from "../schemas.js";
import { IssueError } from "./errors.js";
import { nextSiblingOrder, siblingGroupKey } from "../order.js";
import { derive } from "./derive.js";
import { mergeImplementingOverlay } from "./implementing-status.js";
import { planningStatusById } from "./planning-status.js";
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
import { ensureSpecReviewRenamed } from "./story-review.js";
import { ensureSourceIdeaMigrated } from "./source-idea-migration.js";
import { ensureReviewRecordsMigrated } from "./review-record-migration.js";
import { ensureGithubCommentsMigrated } from "./github-comment-migration.js";
import { ensureReviewThreadsMigrated } from "./review-thread-migration.js";
import { archiveReviewsOfClosingStories } from "./review-lifecycle.js";
import { ancestorIsArchived } from "./archived-visibility.js";
import { planDeletion, type DeletionResult } from "./deletion.js";
import {
  assertGuestAllowsOutwardEffect,
  GUEST_REFUSED_REVIEW_WORKTREE_CREATE,
} from "./guest-outward-effects.js";
import {
  applyReviewWorktreeTransition,
  attemptReviewWorktreeRemoval,
  reviewWorktreeTransitions,
} from "./review-worktree.js";
import {
  attemptStoryWorktreeRemoval,
  storyIdsForLifecycleRemoval,
} from "./worktree.js";
import { uniqueSlug } from "./slug.js";
import { ancestorChain } from "./subtree.js";
import {
  EXECUTION_GATE_STAKEHOLDER_ERROR,
  validateAppendToPatch,
  validateExecutionGatePatch,
  validateNonClearablePatch,
  validateSourceIdeaPatch,
} from "./patch.js";
import { validateCommitsPatch } from "./commit-sha.js";
import { planCodeGateMergePolicyLowering } from "./code-gate-merge-policy.js";
import { planWorkQueueStamps } from "./work-queue.js";
import {
  assertMergePolicyLattice,
  validateMergePolicyPatch,
} from "./merge-policy.js";
import { validateWorkspacePatch, validateWorkspacePath } from "./workspace.js";
import { validateSupportingDocsPatch } from "./supporting-docs.js";
import { validateRuntimePatch } from "./runtime.js";
import { validateInspirationAppsPatch } from "./inspiration-apps.js";
import { validatePersonasPatch } from "./personas.js";
import {
  planLabelCatalogCascade,
  planLabelCatalogRename,
  singleCatalogIdRename,
  type LabelCascadePatch,
} from "./labels.js";
import { assertAllowedAgentModelSlug } from "../agent-model-slugs.js";
import {
  assertMergedAtPatchAllowed,
  isStoryMergeFlip,
  mergeCascade,
  stampMergedAtOnStoryMergeFlip,
  ensureMergedAtBackfilled,
} from "./merge-consequences.js";
import { assertStoreWritable, refusesStoreWrites } from "./store-read-only.js";
import { replaceFileAtomically, withIssuesStoreLock } from "./issues-store-lock.js";
import {
  onDiskHasUnknownKeys,
  readDescription,
  toIssueDetail,
  versionOf,
} from "./issues-detail.js";
import { issueJsonPath, readIssueFile } from "./issues-file.js";
import { readSnapshot } from "./issues-snapshot.js";

export { commentsJsonPath as commentsPathOf } from "./issues-file.js";
export { onDiskHasUnknownKeys, readDescription, versionOf } from "./issues-detail.js";
export { readSnapshot, type IssueSnapshot } from "./issues-snapshot.js";
export {
  appendComment,
  appendCommentLogRecords,
  buildStoredComment,
  readComments,
} from "./comment-append.js";

let writeChain: Promise<unknown> = Promise.resolve();

// Exported, with `readAll`/`readDescription`/`readIssueOrThrow`/
// `commitIssueBatch`, so sibling writers in the service layer (e.g. `apply`,
// attachments) can read the current graph or a single issue and commit a
// validated batch inside this same in-process write chain. The promise chain
// orders writers in one process; `withIssuesStoreLock` keeps a second process
// from interleaving. These five are the whole seam: the low-level FS
// primitives stay private to this module.
export function serialize<T>(fn: () => T): Promise<T> {
  try {
    assertStoreWritable();
  } catch (err) {
    return Promise.reject(err);
  }
  const run = writeChain.then(
    () => withIssuesStoreLock(fn),
    () => withIssuesStoreLock(fn),
  );
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function dirOf(id: string): string {
  return join(issuesDir, id);
}

function legacyChatPathOf(id: string): string {
  return join(dirOf(id), "chat.jsonl");
}

function toRecord(issue: Issue): IssueRecord {
  return issue;
}

// Fresh arrays so callers keep owning what they sort or push; the issues inside
// are the snapshot's shared, frozen objects.
export function readAll(): {
  issues: Issue[];
  problems: Problem[];
  commentProblems: Problem[];
} {
  const snapshot = readSnapshot();
  return {
    issues: [...snapshot.issues],
    problems: [...snapshot.problems],
    commentProblems: [...snapshot.commentProblems],
  };
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

// One-time mergedAt backfill. Safe to call from list/create/apply; no-ops
// after the marker file exists.
export function ensureMergedAtMigrated(): void {
  ensureMergedAtBackfilled((story) => {
    persist(story, serializeIssue(story));
  });
}

export function ensureSpecReviewMigrated(): void {
  ensureSpecReviewRenamed();
}

export function ensureSourceIdeaMigration(): void {
  ensureSourceIdeaMigrated();
}

/** Run every one-shot on-disk migration. Prefer this over calling each ensure* alone. */
export function ensureMigrations(): void {
  if (refusesStoreWrites()) return;
  // Kind rename must run before parseIssue-based migrations (old kinds won't parse).
  ensureKindRenamed();
  ensureMergeBasesMigrated();
  ensureArchivedMigrated();
  ensureMergedAtMigrated();
  ensureSpecReviewMigrated();
  ensureSourceIdeaMigration();
  ensureReviewRecordsMigrated();
  ensureReviewThreadsMigrated();
  ensureGithubCommentsMigrated();
}

/** Every issue in the store, archived ones included. */
export function list(): IssuesResponse {
  if (!refusesStoreWrites() && existsSync(issuesDir)) {
    withIssuesStoreLock(() => {
      ensureMigrations();
    });
  }
  const { issues, problems, commentProblems } = readAll();
  const derived = derive(issues);
  for (const [id, ideaStatus] of Object.entries(planningStatusById(issues))) {
    const existing = derived.byId[id];
    if (existing) existing.ideaStatus = ideaStatus;
    else derived.byId[id] = { blocked: false, ideaStatus };
  }
  mergeImplementingOverlay(issues, derived.byId);
  // Malformed comments.jsonl lines stay on the list. The snapshot revalidates
  // each file's stats and re-parses only files that changed, so an append from
  // any process shows up on the next list.
  const legacyChatProblems = issues.flatMap((issue) => {
    if (!existsSync(legacyChatPathOf(issue.id))) return [];
    return [{ id: issue.id, message: "chat.jsonl" }];
  });
  return {
    issues: issues.map(toRecord),
    problems: [...problems, ...commentProblems, ...legacyChatProblems, ...derived.problems],
    derived: derived.byId,
  };
}

export function read(id: string): IssueDetail {
  return withIssuesStoreLock(() => {
    // Surface post-migration fields on show/detail without requiring a prior list.
    ensureMigrations();
    if (!existsSync(dirOf(id))) {
      throw new IssueError("not_found", `unknown issue "${id}"`);
    }
    const { issue, problem, text } = readIssueFile(id);
    if (!issue || text === undefined) {
      throw new IssueError("validation", problem?.message ?? `invalid issue "${id}"`);
    }
    return toIssueDetail(issue, text, readDescription(id));
  });
}

export function readIssueOrThrow(id: string): Issue {
  if (!existsSync(dirOf(id))) {
    throw new IssueError("not_found", `unknown issue "${id}"`);
  }
  const { issue, problem } = readIssueFile(id);
  if (!issue) {
    throw new IssueError("validation", problem?.message ?? `invalid issue "${id}"`);
  }
  return issue;
}

export function readReviewOrThrow(id: string): ReviewIssue {
  const issue = readIssueOrThrow(id);
  if (issue.kind !== "review") {
    throw new IssueError("validation", `issue "${id}" is not a review`);
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
  assertStoreWritable();
  const dir = dirOf(issue.id);
  mkdirSync(dir, { recursive: true });
  replaceFileAtomically(issueJsonPath(issue.id), jsonText);
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
  assertStoreWritable();
  for (const { issue, description } of writes) {
    persist(issue, serializeIssue(issue));
    if (description !== undefined) {
      replaceFileAtomically(join(dirOf(issue.id), "description.md"), description);
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
    if (input.kind === "review") {
      throw new IssueError("validation", "a review is started from its Story");
    }
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
    if (input.kind === "idea") {
      if (input.stakeholder) {
        assertAllowedAgentModelSlug(input.stakeholder);
        draft.stakeholder = input.stakeholder;
      }
      if (input.outlineGate === true) {
        draft.outlineGate = true;
      }
      if (input.executionGate === true) {
        draft.executionGate = true;
      }
      if (input.approvalPending === true) {
        draft.approvalPending = true;
      }
      if (input.codeApprovalRequired === true) {
        draft.codeApprovalRequired = true;
      }
      if (draft.executionGate === true && !draft.stakeholder) {
        throw new IssueError("conflict", EXECUTION_GATE_STAKEHOLDER_ERROR);
      }
      if (input.stakeholder) {
        const project = issues.find(
          (issue) => issue.id === input.partOf && issue.kind === "project",
        );
        if (project?.kind === "project" && project.autonomous === true) {
          draft.planQueuedAt = now;
        }
      }
    }
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
    if (
      (input.kind === "epic" || input.kind === "story") &&
      input.mergePolicy
    ) {
      draft.mergePolicy = input.mergePolicy;
    }

    const parsed = parseIssue(draft);
    if (!parsed.ok) throw new IssueError("validation", parsed.message);

    assertWritable(parsed.issue, issues);
    persist(parsed.issue, serializeIssue(parsed.issue));
    replaceFileAtomically(
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
    return toIssueDetail(projectParsed.issue, jsonText, readDescription(projectId));
  });
}

function sameCommitShas(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((sha, index) => sha === right[index]);
}

export function update(
  id: string,
  patch: IssuePatch,
  options?: { refreshPrFacts?: boolean },
): Promise<IssueDetail> {
  const refreshPrFacts = options?.refreshPrFacts !== false;
  return serialize(() => {
    const existing = readIssueOrThrow(id);
    const { issues } = readAll();

    const { description, ...jsonPatch } = patch;
    validateWorkspacePatch(jsonPatch);
    validateSupportingDocsPatch(existing, jsonPatch);
    validateRuntimePatch(existing, jsonPatch);
    validateInspirationAppsPatch(existing, jsonPatch);
    validatePersonasPatch(existing, jsonPatch);
    validateCommitsPatch(jsonPatch);
    validateNonClearablePatch(existing, jsonPatch);
    validateMergePolicyPatch(existing, jsonPatch, issues);
    validateSourceIdeaPatch(existing, jsonPatch, issues);
    validateAppendToPatch(existing, jsonPatch, issues);
    validateExecutionGatePatch(existing, jsonPatch);
    if (
      existing.kind === "idea" &&
      "stakeholder" in jsonPatch &&
      jsonPatch.stakeholder !== undefined &&
      jsonPatch.stakeholder !== null
    ) {
      assertAllowedAgentModelSlug(jsonPatch.stakeholder);
    }

    const renameError = branchNameRenameError(existing, jsonPatch, issues);
    if (renameError) throw new IssueError("validation", renameError);
    if (
      jsonPatch.workQueuedAt !== undefined &&
      jsonPatch.workQueuedAt !== null
    ) {
      throw new IssueError(
        "validation",
        "workQueuedAt is system-written; clear it to dequeue",
      );
    }
    if (
      jsonPatch.planQueuedAt !== undefined &&
      jsonPatch.planQueuedAt !== null
    ) {
      throw new IssueError(
        "validation",
        "planQueuedAt is system-written; clear it to dequeue",
      );
    }

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

    const storyMergeFlip = isStoryMergeFlip(existing, parsed.issue);
    assertMergedAtPatchAllowed(jsonPatch, storyMergeFlip);

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
    const labelCascadePatches =
      catalogRename && existing.kind === "project"
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
      return {
        detail: read(id),
        attemptIds: [] as string[],
        recordedPrProjectId: undefined,
        reviewWorktrees: { remove: [] as string[], ensure: [] as string[] },
        syncStoryId: undefined as string | undefined,
      };
    }

    const now = new Date().toISOString();
    if (isStoryMergeFlip(existing, parsed.issue)) {
      stampMergedAtOnStoryMergeFlip(parsed.issue, jsonPatch, now);
    }
    const cascaded = applyCascadePatches(
      archivedCascadePatches,
      labelCascadePatches,
      issues,
      now,
    );

    const mergeSiblingWrites: Issue[] = [];
    if (storyMergeFlip) {
      const { landedBase, staleIds } = mergeCascade(issues, id);
      for (const siblingId of staleIds) {
        const sibling = issues.find((issue) => issue.id === siblingId);
        if (!sibling || sibling.kind !== "story") continue;
        mergeSiblingWrites.push({
          ...sibling,
          needsRebase: landedBase!,
          updatedAt: now,
        });
      }
    }

    const writes: IssueWrite[] = [];
    if (!jsonUnchanged || description !== undefined) {
      parsed.issue.updatedAt = now;
      writes.push({ issue: parsed.issue, description });
    }
    for (const child of cascaded) {
      writes.push({ issue: child });
    }
    for (const sibling of mergeSiblingWrites) {
      writes.push({ issue: sibling });
    }
    const codeGateMergePolicyWrites = planCodeGateMergePolicyLowering(
      existing,
      jsonPatch,
      issues,
    ).map((issue) => ({ ...issue, updatedAt: now }));
    const issuesForQueue = issues.map((issue) => {
      const lowered = codeGateMergePolicyWrites.find(
        (root) => root.id === issue.id,
      );
      return lowered ?? issue;
    });
    const workQueueWrites = planWorkQueueStamps(
      existing,
      jsonPatch,
      issuesForQueue,
      now,
    );
    const companionWrites = new Map<string, Issue>();
    for (const root of codeGateMergePolicyWrites) {
      companionWrites.set(root.id, root);
    }
    for (const root of workQueueWrites) {
      companionWrites.set(root.id, root);
    }
    for (const root of companionWrites.values()) {
      writes.push({ issue: root });
    }
    // Only `archived` changes on these reviews, which integrity does not
    // constrain, so they stay out of the scoped-check decision below.
    const reviewArchiveWrites = archiveReviewsOfClosingStories(
      [
        { before: existing, after: parsed.issue },
        ...cascaded.map((child) => ({ before: byId.get(child.id)!, after: child })),
      ],
      issues,
      now,
    );
    for (const review of reviewArchiveWrites) {
      writes.push({ issue: review });
    }
    const reviewWorktrees = reviewWorktreeTransitions(
      existing,
      parsed.issue,
      reviewArchiveWrites,
    );

    if (
      cascaded.length === 0 &&
      mergeSiblingWrites.length === 0 &&
      companionWrites.size === 0
    ) {
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
      if (codeGateMergePolicyWrites.length > 0) {
        assertMergePolicyLattice([...prospective.values()]);
      }
    }

    if (reviewWorktrees.ensure.length > 0) {
      assertGuestAllowsOutwardEffect(GUEST_REFUSED_REVIEW_WORKTREE_CREATE);
    }
    commitIssueBatch(writes, []);
    const jsonText = serializeIssue(parsed.issue);
    const finalDescription =
      description !== undefined ? description : readDescription(id);
    const recordedPrProjectId =
      refreshPrFacts &&
      existing.kind === "story" &&
      parsed.issue.kind === "story" &&
      parsed.issue.prUrl !== undefined &&
      parsed.issue.prUrl !== existing.prUrl
        ? ancestorChain(id, issues)[0]!.id
        : undefined;
    const syncStoryId =
      existing.kind === "task" &&
      next.kind === "task" &&
      !sameCommitShas(existing.commits, next.commits)
        ? existing.partOf
        : undefined;
    return {
      detail: toIssueDetail(parsed.issue, jsonText, finalDescription),
      attemptIds: storyIdsForLifecycleRemoval(
        existing,
        parsed.issue,
        archivedCascadePatches,
        issues,
      ),
      recordedPrProjectId,
      reviewWorktrees,
      syncStoryId,
    };
  }).then(async ({ detail, attemptIds, recordedPrProjectId, reviewWorktrees, syncStoryId }) => {
    if (recordedPrProjectId) {
      const { refreshRecordedPrFacts } = await import("./pr-facts-read.js");
      await refreshRecordedPrFacts(recordedPrProjectId);
    }
    const followWorktrees =
      attemptIds.length > 0 ||
      reviewWorktrees.remove.length > 0 ||
      reviewWorktrees.ensure.length > 0;
    if (followWorktrees) {
      for (const storyId of attemptIds) {
        await attemptStoryWorktreeRemoval(storyId);
      }
      await applyReviewWorktreeTransition(reviewWorktrees);
    }
    if (syncStoryId) {
      const { syncReviewsAtStoryTip } = await import("./review-worktree-sync.js");
      // The issue write already landed. A checkout failure must not report
      // that write as failed; the next sync retries it.
      try {
        await syncReviewsAtStoryTip(syncStoryId);
      } catch (err) {
        console.error(`review worktree sync failed for story ${syncStoryId}:`, err);
      }
    }
    return followWorktrees ? read(id) : detail;
  });
}

/** Statuses of the Tasks a comment log's threads can link: a review's Story Tasks. */
export function linkableTaskStatuses(
  owner: Issue,
  issues: Issue[] = readAll().issues,
): Map<string, TaskStatus> {
  const statuses = new Map<string, TaskStatus>();
  if (owner.kind !== "review") return statuses;
  for (const issue of issues) {
    if (issue.kind === "task" && issue.partOf === owner.story) {
      statuses.set(issue.id, issue.status);
    }
  }
  return statuses;
}

// Deleting an issue removes the whole containment subtree (the issue plus every
// descendant `partOf` it) and repairs every surviving foreign reference into it:
// a branch stacked on a deleted branch is spliced to the deleted branch's own
// fork point, deleted ids are dropped from any Epic's `blockedBy`, and
// `sourceIdea` is cleared on surviving Epics, root Stories, and Tasks. The
// prospective surviving set is validated before anything is written, so a
// deletion that could not leave the graph valid is refused without side effects.
// `appendTo` is cleared on surviving Ideas when the target Story is deleted.
export async function remove(id: string): Promise<DeletionResult> {
  if (!existsSync(dirOf(id))) {
    throw new IssueError("not_found", `unknown issue "${id}"`);
  }

  const graph = readAll().issues;
  const preview = planDeletion(graph, id);
  const kinds = new Map(graph.map((issue) => [issue.id, issue.kind]));
  const retainedWorktrees: DeletionResult["retainedWorktrees"] = [];
  for (const delId of preview.deleteIds) {
    const result =
      kinds.get(delId) === "review"
        ? await attemptReviewWorktreeRemoval(delId)
        : await attemptStoryWorktreeRemoval(delId);
    if (result.outcome === "retained") {
      retainedWorktrees.push({ id: delId, path: result.path });
    }
  }

  return serialize(() => {
    assertStoreWritable();
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
    for (const { id: bid } of plan.dropSourceIdea) {
      const patch = patchOf.get(bid) ?? {};
      patch.sourceIdea = null;
      patchOf.set(bid, patch);
    }
    for (const { id: bid } of plan.dropAppendTo) {
      const patch = patchOf.get(bid) ?? {};
      patch.appendTo = null;
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
      droppedSourceIdea: plan.dropSourceIdea,
      droppedAppendTo: plan.dropAppendTo,
      retainedWorktrees,
    };
  });
}

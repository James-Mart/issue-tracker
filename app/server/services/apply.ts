import { kindHas } from "../kind.js";
import { parseIssue, type Issue, type IssueKind, type IssuePatch } from "../schemas.js";
import {
  EPIC_RUNTIME_OPTIONAL_KEYS,
  IDEA_RUNTIME_OPTIONAL_KEYS,
  PROJECT_FIELD_KEYS,
  STORY_RUNTIME_OPTIONAL_KEYS,
  TASK_RUNTIME_OPTIONAL_KEYS,
} from "../fields.js";
import type { ApplyDoc, DesiredIssue } from "./apply-schema.js";
import { flattenApplyDoc, isStoryDoc, isEpicDoc } from "./apply-schema.js";
import {
  commitIssueBatch,
  ensureMigrations,
  onDiskHasUnknownKeys,
  readAll,
  readDescription,
  serialize,
  type IssueWrite,
} from "./issues.js";
import { checkIntegrity } from "./integrity.js";
import { nextSiblingOrder } from "../order.js";
import { IssueError } from "./errors.js";
import { mergeIssue } from "./merge.js";
import { ancestorIsArchived } from "./archived-visibility.js";
import { subtreeIds } from "./subtree.js";

// What `apply` changed, by id. On an idempotent re-apply all three are empty.
export interface ApplySummary {
  created: string[];
  updated: string[];
  deleted: string[];
}

// Build the on-disk issue for a desired doc node. Doc-owned fields (title,
// partOf, stackedOn, and the Epic's blockedBy) come from the doc.
// Imperative/progress fields
// (retro, status, qa, commitSha, noDiff, branchName, prUrl, merged, specReview, assignee,
// needsAttention, attentionReason, archived, workspace, mergePolicy, labels, supportingDocs,
// inspirationApps) and
// `createdAt` are preserved from a same-kind existing issue; for a brand-new issue they are left
// off the draft entirely so `parseIssue` fills them from the schema `.default()`s — except
// `archived`, which is seeded true when any ancestor is archived (matching `create`).
// Story `mergeBase` is derived on read (not stored). `apply` never reads or writes
// runtime state beyond preserving it, and never touches chat.jsonl. `updatedAt` is set
// to `now`; callers revert it when nothing actually changed so re-apply does not churn
// timestamps.
function buildIssue(
  desired: DesiredIssue,
  existing: Issue | undefined,
  now: string,
  preserveStackedOn: boolean,
  onDisk: Issue[],
): Issue {
  const draft: Record<string, unknown> = {
    id: desired.id,
    kind: desired.kind,
    title: desired.title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const partOf = desired.kind === "project" ? undefined : desired.partOf;

  // Resolve `stackedOn` up front so both the draft and the sibling-order math
  // key off the same fork point. Normally it is doc-owned (inferred from
  // nesting); a branch-rooted doc has no nesting, so `preserveStackedOn` keeps
  // the on-disk fork point — a branch doc never moves its fork point.
  let stackedOn: string | undefined;
  if (desired.kind === "story") {
    const prior = existing && existing.kind === "story" ? existing : undefined;
    stackedOn = preserveStackedOn ? prior?.stackedOn : desired.stackedOn;
  }

  // Non-root nodes carry a doc-derived `order` (their array index). Only the
  // doc's root emits `order: undefined`: re-applying an existing root preserves
  // its on-disk order, while a brand-new root appends to its sibling group so it
  // never collides at 0 with an existing sibling (e.g. a new epic in a project).
  if (desired.order !== undefined) {
    draft.order = desired.order;
  } else if (existing?.order !== undefined) {
    draft.order = existing.order;
  } else {
    draft.order = nextSiblingOrder(onDisk, desired.kind, partOf, stackedOn);
  }

  // Project-only runtime fields vs partOf children (Epic / Idea / Story / Task).
  if (desired.kind === "project") {
    const prior = existing?.kind === "project" ? existing : undefined;
    if (prior) {
      for (const key of PROJECT_FIELD_KEYS) {
        if (prior[key] !== undefined) draft[key] = prior[key];
      }
    }
  } else {
    draft.partOf = desired.partOf;
    const prior =
      existing && existing.kind === desired.kind ? existing : undefined;
    if (kindHas(desired.kind, "attention") && prior && kindHas(prior.kind, "attention")) {
      draft.needsAttention = prior.needsAttention;
      draft.attentionReason = prior.attentionReason;
    }
    if (
      kindHas(desired.kind, "assignee") &&
      prior &&
      kindHas(prior.kind, "assignee") &&
      prior.assignee !== undefined
    ) {
      draft.assignee = prior.assignee;
    }
    if (kindHas(desired.kind, "archived")) {
      if (prior && kindHas(prior.kind, "archived")) {
        draft.archived = prior.archived;
      } else if (ancestorIsArchived(desired.partOf, onDisk)) {
        draft.archived = true;
      }
    }
  }

  if (desired.kind === "epic") {
    draft.blockedBy = desired.blockedBy ?? [];
    const prior = existing && existing.kind === "epic" ? existing : undefined;
    if (prior) {
      for (const key of EPIC_RUNTIME_OPTIONAL_KEYS) {
        if (prior[key] !== undefined) draft[key] = prior[key];
      }
    }
  }

  if (desired.kind === "idea") {
    const prior = existing && existing.kind === "idea" ? existing : undefined;
    if (prior) {
      for (const key of IDEA_RUNTIME_OPTIONAL_KEYS) {
        if (prior[key] !== undefined) draft[key] = prior[key];
      }
    }
  }

  if (desired.kind === "story") {
    const prior = existing && existing.kind === "story" ? existing : undefined;
    if (stackedOn !== undefined) draft.stackedOn = stackedOn;
    if (prior) {
      draft.merged = prior.merged;
      for (const key of STORY_RUNTIME_OPTIONAL_KEYS) {
        if (prior[key] !== undefined) draft[key] = prior[key];
      }
    }
  }

  if (desired.kind === "task") {
    const prior = existing && existing.kind === "task" ? existing : undefined;
    if (prior) {
      draft.status = prior.status;
      for (const key of TASK_RUNTIME_OPTIONAL_KEYS) {
        if (prior[key] !== undefined) draft[key] = prior[key];
      }
    }
  }

  const parsed = parseIssue(draft);
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  return parsed.issue;
}

// Repair a surviving issue's references into the prune set. In-scope epics are
// fully rebuilt from the doc, so only out-of-scope survivors can dangle, and
// only via an Epic's `blockedBy` (the sole cross-Epic edge); `stackedOn` stays
// within one Epic so it never crosses a scope boundary. Mirrors the drop rule
// in deletion.ts. Returns the (possibly rewritten) issue and whether it changed.
function repairSurvivor(
  issue: Issue,
  deleteSet: Set<string>,
  now: string,
): { issue: Issue; changed: boolean } {
  if (issue.kind !== "epic") return { issue, changed: false };
  const kept = issue.blockedBy.filter((dep) => !deleteSet.has(dep));
  if (kept.length === issue.blockedBy.length) return { issue, changed: false };
  const patch: IssuePatch = { blockedBy: kept };
  const parsed = parseIssue(mergeIssue(issue, patch));
  if (!parsed.ok) throw new IssueError("validation", parsed.message);
  parsed.issue.updatedAt = now;
  return { issue: parsed.issue, changed: true };
}

interface ResolvedRoot {
  // The node whose on-disk subtree bounds the reconcile/prune scope.
  rootId: string;
  rootKind: IssueKind;
  // Branch-rooted docs preserve the on-disk `stackedOn`; see `buildIssue`.
  preserveStackedOn: boolean;
}

// Resolve which node roots the doc and validate any enclosing parents it names
// by id. An epic- or branch-rooted doc reconciles a sub-scope of an existing
// tree, so its parents must already exist with the right kind and containment;
// a violation is refused here before any write. A project-rooted doc has no
// parent to check.
function resolveRoot(
  doc: ApplyDoc,
  onDiskById: Map<string, Issue>,
): ResolvedRoot {
  const requireKind = (id: string, kind: IssueKind): void => {
    const issue = onDiskById.get(id);
    if (!issue) {
      throw new IssueError("validation", `${kind} "${id}" does not exist`);
    }
    if (issue.kind !== kind) {
      throw new IssueError(
        "validation",
        `"${id}" must be a ${kind}, not a ${issue.kind}`,
      );
    }
  };
  // If the root already exists on disk, its parent must match the one the doc
  // declares — an epic/branch cannot be reparented across containers by apply.
  const requireContainment = (childId: string, parentId: string): void => {
    const existing = onDiskById.get(childId);
    if (existing && "partOf" in existing && existing.partOf !== parentId) {
      throw new IssueError(
        "validation",
        `cannot apply "${childId}": it already belongs to "${existing.partOf}", not "${parentId}"`,
      );
    }
  };

  if (isStoryDoc(doc)) {
    requireKind(doc.project, "project");
    if (doc.epic !== undefined) {
      // Epic-scoped story form: project + epic + story.
      requireKind(doc.epic, "epic");
      requireContainment(doc.epic, doc.project);
    } else {
      // Project-level story form: project + story (no epic). Refuse when the
      // on-disk Story already sits under an Epic — that needs the epic-scoped
      // form instead (before the shared containment check below).
      const existing = onDiskById.get(doc.story.id);
      if (existing && existing.kind === "story") {
        const parent = onDiskById.get(existing.partOf);
        if (parent?.kind === "epic") {
          throw new IssueError(
            "validation",
            `cannot apply "${doc.story.id}": it belongs to epic "${existing.partOf}"; use the epic-scoped story form (project + epic + story)`,
          );
        }
      }
    }
    // Same parent expression as flatten (`doc.epic ?? doc.project`).
    requireContainment(doc.story.id, doc.epic ?? doc.project);
    return { rootId: doc.story.id, rootKind: "story", preserveStackedOn: true };
  }
  if (isEpicDoc(doc)) {
    requireKind(doc.project, "project");
    requireContainment(doc.epic.id, doc.project);
    return { rootId: doc.epic.id, rootKind: "epic", preserveStackedOn: false };
  }
  return { rootId: doc.project.id, rootKind: "project", preserveStackedOn: false };
}

// Reconcile the declared root's subtree to match `doc`: create new nodes, update
// existing ones (preserving imperative/progress state), and prune on-disk issues
// in that subtree the doc omits. The root is a Project, an Epic, or a Story (see
// `resolveRoot`), so the scope can be a whole project, one epic, or one branch's
// commit list. The entire prospective set is validated with a single
// `checkIntegrity` pass before any write, so a doc that would leave the graph
// broken is refused with no changes on disk. Runs inside the shared write chain
// so it cannot race HTTP/CLI writes.
export function apply(doc: ApplyDoc): Promise<ApplySummary> {
  return serialize(() => {
    // Same one-time migrations as list/create — strip stored mergeBase before
    // unset on new stacked children; archived before create-under-archived.
    ensureMigrations();
    const now = new Date().toISOString();
    const desired = flattenApplyDoc(doc);

    const { issues } = readAll();
    const onDiskById = new Map(issues.map((issue) => [issue.id, issue]));
    const { rootId, rootKind, preserveStackedOn } = resolveRoot(doc, onDiskById);
    // Scope is bounded to the declared root's on-disk subtree; anything else
    // is untouched except for reference repair when a pruned epic is a blocker.
    const scope = subtreeIds(issues, rootId);
    const desiredIds = new Set(desired.map((node) => node.id));

    const created: string[] = [];
    const updated: string[] = [];
    // Full prospective issue set, keyed by id, that must pass integrity as a whole.
    const prospective = new Map<string, Issue>();
    // Writes to commit only after integrity passes.
    const writes: IssueWrite[] = [];

    for (const node of desired) {
      const existing = onDiskById.get(node.id);
      if (existing && !scope.has(node.id)) {
        throw new IssueError(
          "validation",
          `cannot apply "${node.id}": id already exists outside the target ${rootKind} "${rootId}"`,
        );
      }

      const next = buildIssue(node, existing, now, preserveStackedOn, issues);

      if (!existing) {
        prospective.set(next.id, next);
        writes.push({ issue: next, description: node.description ?? `# ${node.title}\n` });
        created.push(next.id);
        continue;
      }

      // Compare with `updatedAt` normalized so an unchanged node keeps its
      // timestamp and is not rewritten. Both objects come from parseIssue, so
      // their key order matches and JSON.stringify is a stable comparison.
      const probe: Issue = { ...next, updatedAt: existing.updatedAt };
      const jsonChanged = JSON.stringify(probe) !== JSON.stringify(existing);
      const descChanged =
        node.description !== undefined &&
        node.description !== readDescription(node.id);
      // A file can be semantically unchanged yet still carry stale keys the
      // schema now strips on read (e.g. a Branch's pre-migration `blockedBy`).
      // Re-apply reconciles the doc against disk, so tidy those off too.
      const staleOnDisk = onDiskHasUnknownKeys(existing);

      if (!jsonChanged && !descChanged && !staleOnDisk) {
        prospective.set(existing.id, existing);
        continue;
      }
      // A stale-key-only rewrite is not a semantic change, so preserve the
      // existing `updatedAt` (the normalized `probe`) rather than churning it.
      const rewritten = !jsonChanged && !descChanged ? probe : next;
      prospective.set(rewritten.id, rewritten);
      writes.push({
        issue: rewritten,
        description: descChanged ? node.description : undefined,
      });
      updated.push(next.id);
    }

    // Prune: on-disk issues in the root's subtree the doc no longer declares.
    // This deliberately does not delegate to `planDeletion`/`remove()`. That
    // planner's job is to *inherit* a deleted branch's fork point onto surviving
    // stacked branches; here every in-scope reference has already been rebuilt
    // from the doc's nesting, so re-inheriting fork points would fight the doc.
    // The only edge that can still dangle is an out-of-scope Epic's `blockedBy`
    // into the prune set, repaired below (see `repairSurvivor`). Project-root
    // docs declare Epics, Ideas, and project-level Stories under `children:`;
    // omitted ones are pruned. Epic-/story-rooted docs never include Ideas in
    // scope (Ideas are Project children), so those forms leave Ideas untouched.
    const deleteSet = new Set(
      [...scope].filter((id) => !desiredIds.has(id)),
    );

    // Fold surviving out-of-scope issues (with blockedBy repair) into the set.
    for (const issue of issues) {
      if (deleteSet.has(issue.id) || desiredIds.has(issue.id)) continue;
      const { issue: repaired, changed } = repairSurvivor(issue, deleteSet, now);
      prospective.set(repaired.id, repaired);
      if (changed) writes.push({ issue: repaired });
    }

    const problems = checkIntegrity([...prospective.values()]);
    if (problems.length > 0) {
      throw new IssueError(
        "validation",
        problems.map((p) => p.message).join("; "),
      );
    }

    commitIssueBatch(writes, [...deleteSet]);

    return { created, updated, deleted: [...deleteSet] };
  });
}

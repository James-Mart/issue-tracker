import { hasAttention } from "@server/kind";
import { bySequence, epicsBlockedBy, isProjectBoardChild } from "@server/order";
import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  boardKindAllows,
  type BoardKindFilter,
} from "./board-kind-filter";
import { issuesById, projectIdOf } from "./build-tree";
import { isInFlight, isIssueComplete } from "./derived";
import { filterIssuesBySearchAndLabels } from "./filter-by-search-labels";
import { issueRailNodeState, type RailNodeState } from "./rail-state";

type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

export type { RailNodeState };

export type FlowItem = {
  issue: IssueRecord;
  state: DerivedState | undefined;
};

/** Idea row in the awaiting-planning bucket (captured, not yet directed). */
export function isCapturedIdeaFlowItem(
  item: FlowItem,
): item is FlowItem & { issue: Extract<IssueRecord, { kind: "idea" }> } {
  return item.issue.kind === "idea" && item.state?.ideaStatus === "captured";
}

export type DepGraphNode = {
  id: string;
  label: string;
  state: RailNodeState;
};

export type DepGraphEdge = {
  from: string;
  to: string;
  satisfied: boolean;
};

export type DepGraphModel = {
  nodes: DepGraphNode[];
  edges: DepGraphEdge[];
};

export type FlowBuckets = {
  awaitingPlanning: FlowItem[];
  ready: FlowItem[];
  inFlight: FlowItem[];
  blocked: FlowItem[];
  recentlyMerged: FlowItem[];
};

export type FlowScope = {
  projectId?: string;
};

/** In-memory Flow lens filters (search / label / kind). Archive is applied separately. */
export type FlowFilters = {
  search: string;
  labelIds: readonly string[];
  kind: BoardKindFilter;
};

export function flowFiltersActive(filters: FlowFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.labelIds.length > 0 ||
    filters.kind.length > 0
  );
}

/**
 * Story/Epic/Idea ids kept under Flow filters. Search/label via shared
 * `filterIssuesBySearchAndLabels` (ancestor retention), then kind via
 * `boardKindAllows`.
 */
export function matchingFlowIssueIds(
  issues: IssueRecord[],
  filters: FlowFilters,
  derived: Record<string, DerivedState> = {},
): Set<string> {
  const byId = issuesById(issues);
  const next = filterIssuesBySearchAndLabels(
    issues,
    filters.search,
    filters.labelIds,
  );
  const keep = new Set<string>();
  for (const issue of next) {
    if (
      isFlowTopLevelRow(issue, byId, derived) &&
      boardKindAllows(issue.kind, filters.kind)
    ) {
      keep.add(issue.id);
    }
  }
  return keep;
}

/** Narrow bucketed Flow rows by search / label / kind. Pure — no I/O. */
export function filterFlowBuckets(
  buckets: FlowBuckets,
  issues: IssueRecord[],
  filters: FlowFilters,
  derived: Record<string, DerivedState> = {},
): FlowBuckets {
  if (!flowFiltersActive(filters)) return buckets;
  const keep = matchingFlowIssueIds(issues, filters, derived);
  const take = (items: FlowItem[]) =>
    items.filter((item) => keep.has(item.issue.id));
  return {
    awaitingPlanning: take(buckets.awaitingPlanning),
    ready: take(buckets.ready),
    inFlight: take(buckets.inFlight),
    blocked: take(buckets.blocked),
    recentlyMerged: take(buckets.recentlyMerged),
  };
}

/**
 * Epic, project-level Story, or Idea that is not `planned`. Tasks and
 * Epic-child Stories stay out. A planned Idea's plan root is already a row.
 */
function isFlowTopLevelRow(
  issue: IssueRecord,
  byId: Map<string, IssueRecord>,
  derived: Record<string, DerivedState> = {},
): issue is IssueRecord & { kind: "story" | "epic" | "idea" } {
  if (issue.kind !== "epic" && issue.kind !== "story" && issue.kind !== "idea") {
    return false;
  }
  if (!isProjectBoardChild(issue, byId)) return false;
  // `isProjectBoardChild` keys off the immediate parent id; require a Project
  // parent so an epic nested under another epic (writable via the API) stays out.
  if (byId.get(issue.partOf)?.kind !== "project") return false;
  if (issue.kind === "idea") {
    return derived[issue.id]?.ideaStatus !== "planned";
  }
  return true;
}

/** Attention for Flow: stored flag on Epics/Stories, stall only on planning. */
export function flowItemNeedsAttention(item: FlowItem): boolean {
  if (item.issue.kind === "idea") {
    return item.state?.ideaStatus === "awaiting-direction";
  }
  return hasAttention(item.issue) && item.issue.needsAttention;
}

/**
 * Current in-flight Task under a Flow row (Story or Epic): status
 * `in-progress` or `fixing`, earliest by sequence. Undefined when none.
 * Pass `byId` when the caller already has `issuesById(issues)` (e.g. per-row).
 */
export function inFlightTaskOf(
  rowIssue: IssueRecord,
  issues: IssueRecord[],
  byId?: Map<string, IssueRecord>,
): TaskRecord | undefined {
  if (rowIssue.kind !== "story" && rowIssue.kind !== "epic") return undefined;
  const index = byId ?? issuesById(issues);
  const tasks = issues.filter((issue): issue is TaskRecord => {
    if (issue.kind !== "task" || !isInFlight(issue, undefined)) return false;
    if (rowIssue.kind === "story") return issue.partOf === rowIssue.id;
    const story = index.get(issue.partOf);
    return story?.kind === "story" && story.partOf === rowIssue.id;
  });
  tasks.sort(bySequence);
  return tasks[0];
}

function isInFlightBucket(
  issue: IssueRecord & { kind: "story" | "epic" | "idea" },
  state: DerivedState | undefined,
): boolean {
  if (issue.kind === "idea") return state?.ideaStatus === "planning";
  if (issue.kind === "story") {
    return (
      state?.storyStatus === "in-progress" || state?.storyStatus === "pr-open"
    );
  }
  return state?.epicStatus === "in-progress";
}

function isRecentlyMerged(
  issue: IssueRecord & { kind: "story" | "epic" | "idea" },
  state: DerivedState | undefined,
): boolean {
  return isIssueComplete(issue, state);
}

/**
 * Bucket Stories, Epics, and Ideas into awaitingPlanning / ready / inFlight /
 * blocked / recentlyMerged. Pure view-model — no I/O. `inFlight` is broader
 * than the `isInFlight` liveness helper: it includes `pr-open` Stories and
 * Ideas whose status is `planning`. Captured Ideas go to `awaitingPlanning`.
 */
export function flowBuckets(
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
  scope: FlowScope = {},
): FlowBuckets {
  const byId = issuesById(issues);
  const candidates = issues.filter(
    (issue): issue is IssueRecord & { kind: "story" | "epic" | "idea" } => {
      if (!isFlowTopLevelRow(issue, byId, derived)) return false;
      if (scope.projectId === undefined) return true;
      return projectIdOf(issue.id, byId) === scope.projectId;
    },
  );

  const awaitingPlanning: FlowItem[] = [];
  const ready: FlowItem[] = [];
  const inFlight: FlowItem[] = [];
  const blocked: FlowItem[] = [];
  const recentlyMerged: FlowItem[] = [];

  for (const issue of candidates) {
    const state = derived[issue.id];
    const item: FlowItem = { issue, state };
    if (issue.kind === "idea" && state?.ideaStatus === "captured") {
      awaitingPlanning.push(item);
    } else if (state?.blocked) {
      blocked.push(item);
    } else if (isInFlightBucket(issue, state)) {
      inFlight.push(item);
    } else if (isRecentlyMerged(issue, state)) {
      recentlyMerged.push(item);
    } else {
      ready.push(item);
    }
  }

  recentlyMerged.sort((a, b) =>
    b.issue.updatedAt.localeCompare(a.issue.updatedAt),
  );

  return { awaitingPlanning, ready, inFlight, blocked, recentlyMerged };
}

/**
 * An Epic plus its direct `blockedBy` / blocking neighbors — the detail
 * own-flow neighborhood (not the full project DAG).
 */
export function epicDependencyNeighborhood(
  epicId: string,
  issues: readonly IssueRecord[],
): Array<IssueRecord & { kind: "epic" }> {
  const list = [...issues];
  const byId = issuesById(list);
  const focus = byId.get(epicId);
  if (!focus || focus.kind !== "epic") return [];

  const ids = new Set<string>([epicId]);
  for (const id of focus.blockedBy) ids.add(id);
  for (const dependent of epicsBlockedBy(epicId, list)) {
    ids.add(dependent.id);
  }

  return [...ids].flatMap((id) => {
    const issue = byId.get(id);
    return issue?.kind === "epic" ? [issue] : [];
  });
}

/**
 * Build a node-link DAG model of Epics and their `blockedBy` edges.
 * Edge direction is prerequisite → dependent. Pure view-model — no I/O.
 * Edges whose prerequisite is outside the supplied epic set are omitted.
 */
export function depGraphModel(
  epics: IssueRecord[],
  derived: Record<string, DerivedState>,
): DepGraphModel {
  const epicRecords = epics.filter(
    (issue): issue is IssueRecord & { kind: "epic" } => issue.kind === "epic",
  );
  const epicIds = new Set(epicRecords.map((issue) => issue.id));

  const nodes: DepGraphNode[] = epicRecords.map((issue) => ({
    id: issue.id,
    label: issue.title,
    state: issueRailNodeState(issue, derived[issue.id]),
  }));

  const edgeKeys = new Set<string>();
  const edges: DepGraphEdge[] = [];
  for (const issue of epicRecords) {
    for (const from of issue.blockedBy) {
      if (!epicIds.has(from)) continue;
      const key = `${from}\0${issue.id}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({
        from,
        to: issue.id,
        satisfied: derived[from]?.epicStatus === "done",
      });
    }
  }

  return { nodes, edges };
}

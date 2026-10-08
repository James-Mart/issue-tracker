import {
  ChevronRight,
  GitBranch,
  FolderKanban,
  GitCommitHorizontal,
  GitPullRequest,
  Layers,
  Lightbulb,
  Plus,
  Trash2,
} from "lucide-react";
import { memo, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { assigneeOf } from "@server/assignee";
import { isProjectBoardChild } from "@server/order";
import { hasAttention } from "@server/kind";
import { CHILD_KIND } from "@server/issue-constants";
import { taskHeadCommit } from "@server/services/commit-sha";
import type {
  DerivedState,
  IssueKind,
  IssueRecord,
  ProjectLabel,
} from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { OverviewRow } from "@/components/ui/overview-row";
import { Rail, RailNode } from "@/components/ui/rail";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useProjectPullRequestsQuery } from "../api/queries";
import {
  StoryTreeDnDProvider,
  useStoryTreeDnD,
  useStoryTreeDnDContext,
} from "../hooks/use-story-tree-dnd";
import { resolveExpanded } from "../store/expanded-state";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import type { IssueNode } from "../lib/build-tree";
import {
  EPIC_STATUS_LABEL,
  isInFlight,
  leafTaskProgressCount,
  RETRO_LABEL,
  REVIEW_LABEL,
  STORY_STATUS_LABEL,
  TASK_STATUS_LABEL,
} from "../lib/derived";
import {
  buildTreeRowIndexes,
  type TreeRowIndexes,
} from "../lib/tree-row-indexes";
import { issuePath } from "../lib/links";
import {
  isLabelAssignableIssue,
  resolveAssignedLabels,
} from "../lib/project-labels";
import { issueRailNodeState } from "../lib/rail-state";
import { RowPrStoreProvider, useRowPrData } from "../lib/row-pr-store";
import { isRowDraggable } from "../lib/story-tree-dnd-logic";
import { ArchiveIssueButton } from "./archive-issue-button";
import { EpicAxisChips, StoryAxisChips } from "./axis-chips";
import { IssueArchiveDeleteMenuItems } from "./issue-archive-delete-menu-items";
import {
  PrChip,
  storyPrChipModelFromRow,
  type PrChipModel,
} from "./pr-chip";
import { ProjectLabelChips } from "./project-label-chips";
import { TaskStatusChips } from "./task-status-chips";

const KIND_ICON: Record<IssueKind, typeof Layers> = {
  project: FolderKanban,
  epic: Layers,
  idea: Lightbulb,
  story: GitBranch,
  task: GitCommitHorizontal,
};

/** Horizontal step per nesting level — also the x-step between a parent port and its children's. */
const TREE_INDENT = 24;
/** Port center relative to a row's own box: `Rail` pads 26px and the 12px port sits at -24. */
const PORT_CENTER_X = -18;
const EMPTY_GUIDES: boolean[] = [];
const EMPTY_CHILD_GUIDES: boolean[][] = [];

function treeRowFallbackExpanded(
  issue: IssueRecord,
  indexes: TreeRowIndexes,
): boolean {
  return isProjectBoardChild(issue, indexes.byId) ? false : true;
}

const guideLine = "pointer-events-none absolute w-px bg-[hsl(var(--rail-lit))]";

/**
 * Leaves carry no box until hover, so the containers own every card on screen.
 * Coarse pointers have no hover and their row overflow menu is always present,
 * which needs the card surface behind it — so there the card stays.
 */
const leafRowSurface = cn(
  "border-transparent bg-transparent",
  "group-hover:border-border group-hover:bg-card",
  "[@media(pointer:coarse)]:border-border [@media(pointer:coarse)]:bg-card",
);

/**
 * The hairlines that make depth readable: one dropping from each still-open
 * ancestor level, the elbow tying this row's port to its parent's line, and —
 * when this row's own children are showing — the descender they hang from.
 * `guides[level]` says whether that level's line continues past this row; level
 * 0 is the Rail's own spine and is never redrawn here. On a blocked row the
 * elbow is the incoming edge, so it takes the Rail's dashed blocked treatment.
 */
function TreeRowGuides({
  guides,
  blocked,
  descends,
}: {
  guides: boolean[];
  blocked: boolean;
  descends: boolean;
}) {
  const depth = guides.length;
  if (depth === 0) return null;
  const lineLeft = (level: number) =>
    PORT_CENTER_X - (depth - level) * TREE_INDENT;

  return (
    <>
      {guides.map((continues, level) =>
        level === 0 || (level < depth - 1 && !continues) ? null : (
          <span
            key={level}
            aria-hidden="true"
            className={cn(guideLine, "top-0", continues ? "bottom-0" : "h-1/2")}
            style={{ left: lineLeft(level) }}
          />
        ),
      )}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2",
          blocked
            ? "border-t-2 border-dashed border-[hsl(var(--blocked))] opacity-[.55]"
            : "h-px bg-[hsl(var(--rail-lit))]",
        )}
        style={{ left: lineLeft(depth - 1), width: TREE_INDENT - 6 }}
      />
      {descends ? (
        <span
          aria-hidden="true"
          className={cn(guideLine, "bottom-0 top-1/2")}
          style={{ left: PORT_CENTER_X }}
        />
      ) : null}
    </>
  );
}

/** Disclosure control for a row with children — a real button, not a bare glyph. */
function TreeExpander({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse" : "Expand"}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <ChevronRight
        className={cn(
          "h-4 w-4 motion-safe:transition-transform",
          expanded && "rotate-90",
        )}
      />
    </button>
  );
}

function PrLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className="text-muted-foreground hover:text-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <GitPullRequest className="h-3.5 w-3.5" />
    </a>
  );
}

function TreeRowDerivedMeta({
  issue,
  derived,
}: {
  issue: IssueRecord;
  derived?: DerivedState;
}) {
  if (issue.kind === "story") {
    const reviewStale = Boolean(issue.review && derived?.reviewCurrent === false);
    return (
      <StoryAxisChips
        storyStatus={derived?.storyStatus}
        review={issue.review}
        reviewStale={reviewStale}
        needsRebase={issue.needsRebase}
        retro={issue.retro}
      />
    );
  }
  if (issue.kind === "epic") {
    return (
      <EpicAxisChips epicStatus={derived?.epicStatus} retro={issue.retro} />
    );
  }
  if (issue.kind === "task") {
    const head = taskHeadCommit(issue);
    if (head) {
      return (
        <span className="font-mono text-xs text-muted-foreground">
          {head.slice(0, 7)}
        </span>
      );
    }
  }
  return null;
}

function RowActions({ issue }: { issue: IssueRecord }) {
  const openNew = useIssueUiStore((s) => s.openNew);
  const requestDelete = useIssueUiStore((s) => s.requestDelete);
  const childKind = CHILD_KIND[issue.kind];

  return (
    <span className="flex items-center gap-0.5">
      {childKind ? (
        issue.kind === "story" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Add child"
                onClick={(e) => e.stopPropagation()}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  openNew({ presetKind: "task", presetParent: issue.id });
                }}
              >
                Add task
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  openNew({
                    presetKind: "story",
                    presetParent: issue.partOf,
                    presetStackedOn: issue.id,
                  });
                }}
              >
                Add stacked story
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            title={`Add ${childKind}`}
            onClick={(e) => {
              e.stopPropagation();
              openNew({ presetKind: childKind, presetParent: issue.id });
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )
      ) : null}
      <ArchiveIssueButton issue={issue} compact />
      <Button
        variant="ghost"
        size="icon-sm"
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          requestDelete(issue.id);
        }}
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </span>
  );
}

/** Read-only chip labels mirrored from the fine-pointer hover overlay. */
export function treeRowTouchChipLabels(
  issue: IssueRecord,
  derived: DerivedState | undefined,
  catalog: ProjectLabel[],
  prChip: PrChipModel,
): string[] {
  const labels: string[] = [];

  if (isLabelAssignableIssue(issue)) {
    for (const label of resolveAssignedLabels(issue.labels, catalog)) {
      labels.push(label.id);
    }
  }

  if (issue.kind === "story") {
    if (prChip.kind === "chip") {
      labels.push(prChip.label);
    }
    if (derived?.storyStatus) {
      labels.push(STORY_STATUS_LABEL[derived.storyStatus]);
    }
    if (issue.review) {
      labels.push(`review: ${REVIEW_LABEL[issue.review]}`);
      if (derived?.reviewCurrent === false) {
        labels.push("review: stale");
      }
    }
    if (issue.needsRebase) {
      labels.push(`needsRebase: ${issue.needsRebase}`);
    }
    if (issue.retro) {
      labels.push(`retro: ${RETRO_LABEL[issue.retro]}`);
    }
  }

  if (issue.kind === "epic") {
    if (derived?.epicStatus) {
      labels.push(EPIC_STATUS_LABEL[derived.epicStatus]);
    }
    if (issue.retro) {
      labels.push(`retro: ${RETRO_LABEL[issue.retro]}`);
    }
  }

  if (issue.kind === "task") {
    labels.push(TASK_STATUS_LABEL[issue.status]);
    const head = taskHeadCommit(issue);
    if (head) {
      labels.push(head.slice(0, 7));
    }
  }

  return labels;
}

function TreeRowTouchMenuMeta({ chipLabels }: { chipLabels: string[] }) {
  if (chipLabels.length === 0) return null;

  return (
    <>
      {chipLabels.map((label, index) => (
        <DropdownMenuItem
          key={`${label}-${index}`}
          disabled
          className="cursor-default opacity-100 focus:bg-transparent"
          onSelect={(event) => event.preventDefault()}
        >
          {label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}

/** Flat overflow menu for coarse pointers — no nested dropdown triggers. */
function TreeRowTouchMenu({
  issue,
  derived,
  catalog,
  prChip,
}: {
  issue: IssueRecord;
  derived?: DerivedState;
  catalog: ProjectLabel[];
  prChip: PrChipModel;
}) {
  const openNew = useIssueUiStore((s) => s.openNew);
  const childKind = CHILD_KIND[issue.kind];
  const chipLabels = treeRowTouchChipLabels(issue, derived, catalog, prChip);

  return (
    <>
      <TreeRowTouchMenuMeta chipLabels={chipLabels} />
      {issue.kind === "story" && issue.prUrl ? (
        <DropdownMenuItem asChild>
          <a href={issue.prUrl} target="_blank" rel="noreferrer">
            <GitPullRequest className="h-4 w-4" />
            Open PR
          </a>
        </DropdownMenuItem>
      ) : null}
      {childKind ? (
        <DropdownMenuItem
          onSelect={() =>
            openNew({ presetKind: childKind, presetParent: issue.id })
          }
        >
          <Plus className="h-4 w-4" />
          Add child…
        </DropdownMenuItem>
      ) : null}
      <IssueArchiveDeleteMenuItems issue={issue} />
    </>
  );
}

type DerivedMap = Record<string, DerivedState>;

type TreeRowProps = {
  node: IssueNode;
  derived: DerivedMap;
  catalog: ProjectLabel[];
  indexes: TreeRowIndexes;
  guides?: boolean[];
  expanded: boolean;
};

/** Skip a row when its own props are unchanged. PR data is not a prop. */
function treeRowPropsAreEqual(prev: TreeRowProps, next: TreeRowProps): boolean {
  return (
    prev.node === next.node &&
    prev.derived === next.derived &&
    prev.catalog === next.catalog &&
    prev.indexes === next.indexes &&
    prev.expanded === next.expanded &&
    prev.guides === next.guides
  );
}

const TreeRow = memo(function TreeRow({
  node,
  derived,
  catalog,
  indexes,
  guides = EMPTY_GUIDES,
  expanded,
}: TreeRowProps) {
  const { projectId = "" } = useParams();
  const { issue } = node;
  const rowPr = useRowPrData(issue);
  const fallbackExpanded = treeRowFallbackExpanded(issue, indexes);
  const toggle = useIssueUiStore((s) => s.toggle);
  const { getRowDnDProps, consumeDragGesture } = useStoryTreeDnDContext();
  const hasChildren = node.children.length > 0;
  const Icon = KIND_ICON[issue.kind];
  // Species, not shape: a kind that can own children reads as a container even
  // while it is still empty.
  const container = CHILD_KIND[issue.kind] !== null;
  const state = derived[issue.id];
  const blocked = Boolean(state?.blocked);
  const rowDraggable = isRowDraggable(issue, indexes);
  const { isDragging, isDropTarget, ...rowDnDHandlers } = getRowDnDProps(issue);
  const assignee = assigneeOf(issue);
  const attention = hasAttention(issue) && issue.needsAttention;
  const count = leafTaskProgressCount(issue, indexes);
  const railState = issueRailNodeState(issue, state, indexes);
  const live = isInFlight(issue, state);
  const prChip = storyPrChipModelFromRow(issue, rowPr);

  return (
      <RailNode
        state={railState}
        // A nested row's incoming edge is its own elbow; only a root row hangs
        // straight off the Rail's spine, where RailNode can draw that edge.
        edge={blocked && guides.length === 0 ? "dashed" : "solid"}
        glow={live}
        className="items-center gap-2 py-1"
        style={
          guides.length > 0
            ? { marginLeft: guides.length * TREE_INDENT }
            : undefined
        }
      >
        <TreeRowGuides
          guides={guides}
          blocked={blocked}
          descends={hasChildren && expanded}
        />
        <div
          className={cn(
            "group flex min-w-0 flex-1 items-center gap-1.5",
            hasChildren && "cursor-pointer",
            rowDraggable && "cursor-grab active:cursor-grabbing",
            isDragging && "opacity-50",
            isDropTarget && "rounded-lg ring-1 ring-ring",
          )}
          {...rowDnDHandlers}
          onClick={
            hasChildren
              ? () => {
                  if (consumeDragGesture()) return;
                  toggle(issue.id, fallbackExpanded);
                }
              : undefined
          }
        >
          {hasChildren ? (
            <TreeExpander
              expanded={expanded}
              onToggle={() => toggle(issue.id, fallbackExpanded)}
            />
          ) : (
            <span className="h-6 w-6 shrink-0" />
          )}
          <OverviewRow
            className={cn("min-w-0 flex-1", !container && leafRowSurface)}
            overlayGroup={false}
            avatar={
              assignee ? (
                <Avatar name={assignee} size="sm" />
              ) : (
                <Icon
                  aria-label={issue.kind}
                  className={
                    container
                      ? "h-4 w-4 text-foreground"
                      : "h-3.5 w-3.5 text-muted-foreground"
                  }
                />
              )
            }
            attention={attention}
            blocked={blocked}
            count={count}
            overlay={
              <>
                <ProjectLabelChips issue={issue} catalog={catalog} />
                {issue.kind === "story" && issue.prUrl ? (
                  <PrLink url={issue.prUrl} />
                ) : null}
                <PrChip model={prChip} />
                <TreeRowDerivedMeta issue={issue} derived={state} />
                {issue.kind === "task" ? (
                  <TaskStatusChips status={issue.status} />
                ) : null}
                <RowActions issue={issue} />
              </>
            }
            touchMenu={
              <TreeRowTouchMenu
                issue={issue}
                derived={state}
                catalog={catalog}
                prChip={prChip}
              />
            }
          >
            <Link
              to={issuePath(projectId, issue.id)}
              state={{
                issueBackStack: [{ kind: "structure", projectId }],
              }}
              className={cn(
                "truncate text-inherit no-underline hover:underline",
                container ? "font-semibold" : "font-normal",
              )}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            >
              {issue.title}
            </Link>
          </OverviewRow>
        </div>
      </RailNode>
  );
}, treeRowPropsAreEqual);

/** Renders one row and, when it is expanded, its children. The row itself is memoized. */
function TreeRowBranch({
  node,
  derived,
  catalog,
  indexes,
  guides,
}: Omit<TreeRowProps, "expanded">) {
  const { issue } = node;
  const fallbackExpanded = treeRowFallbackExpanded(issue, indexes);
  const expanded = useIssueUiStore((s) =>
    resolveExpanded(s.expanded, issue.id, fallbackExpanded),
  );
  const hasChildren = node.children.length > 0;
  const parentGuides = guides ?? EMPTY_GUIDES;
  const childGuides = useMemo(() => {
    if (!expanded || node.children.length === 0) return EMPTY_CHILD_GUIDES;
    return node.children.map((_, index) => [
      ...parentGuides,
      index < node.children.length - 1,
    ]);
  }, [expanded, node.children, parentGuides]);
  return (
    <>
      <TreeRow
        node={node}
        derived={derived}
        catalog={catalog}
        indexes={indexes}
        guides={parentGuides}
        expanded={expanded}
      />
      {hasChildren && expanded
        ? node.children.map((child, index) => (
            <TreeRowBranch
              key={child.issue.id}
              node={child}
              derived={derived}
              catalog={catalog}
              indexes={indexes}
              guides={childGuides[index]}
            />
          ))
        : null}
    </>
  );
}

function ProjectUnstackDropZone({
  projectId,
  indexes,
}: {
  projectId: string;
  indexes: TreeRowIndexes;
}) {
  const { getProjectDnDProps, draggingId } = useStoryTreeDnDContext();
  const dragging = draggingId ? indexes.byId.get(draggingId) : undefined;
  if (!dragging || dragging.kind !== "story") return null;
  const { isDragging: _ignored, isDropTarget, ...handlers } =
    getProjectDnDProps(projectId);
  return (
    <div
      {...handlers}
      className={cn(
        "mb-2 rounded-md border border-dashed px-2 py-1.5 text-center text-xs text-muted-foreground",
        isDropTarget && "border-ring bg-accent text-foreground ring-1 ring-ring",
      )}
    >
      Drop story here to unstack onto project
    </div>
  );
}

function CollapsibleStructureGroup({
  testId,
  headingId,
  title,
  nodes,
  derived,
  catalog,
  indexes,
}: {
  testId: string;
  headingId: string;
  title: string;
  nodes: IssueNode[];
  derived: DerivedMap;
  catalog: ProjectLabel[];
  indexes: TreeRowIndexes;
}) {
  if (nodes.length === 0) return null;

  return (
    <section aria-labelledby={headingId} data-testid={testId}>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 marker:content-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <h2
            id={headingId}
            className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--current))]"
          >
            {title}
            <span className="ml-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              {nodes.length}
            </span>
          </h2>
        </summary>
        <div className="mt-1.5">
          <Rail>
            {nodes.map((node) => (
              <TreeRowBranch
                key={node.issue.id}
                node={node}
                derived={derived}
                catalog={catalog}
                indexes={indexes}
              />
            ))}
          </Rail>
        </div>
      </details>
    </section>
  );
}

export function IssueTree({
  nodes,
  ideaNodes = [],
  doneNodes = [],
  derived,
  issues,
  catalog,
  projectId,
}: {
  nodes: IssueNode[];
  ideaNodes?: IssueNode[];
  doneNodes?: IssueNode[];
  derived: DerivedMap;
  issues: IssueRecord[];
  catalog: ProjectLabel[];
  projectId: string;
}) {
  const indexes = useMemo(() => buildTreeRowIndexes(issues), [issues]);
  const dnd = useStoryTreeDnD(issues, indexes);
  const prQuery = useProjectPullRequestsQuery(projectId);
  const hasHierarchy = nodes.length > 0;
  const hasIdeas = ideaNodes.length > 0;
  const hasDone = doneNodes.length > 0;

  const body =
    !hasHierarchy && !hasIdeas && !hasDone ? (
      <div className="flex flex-col gap-1.5">
        {projectId ? (
          <ProjectUnstackDropZone projectId={projectId} indexes={indexes} />
        ) : null}
        <p className="px-2 py-8 text-center text-sm text-muted-foreground">
          No issues yet. Use New to add an Epic, Story, or Idea.
        </p>
      </div>
    ) : (
      <div className="flex flex-col gap-1.5">
        {projectId ? (
          <ProjectUnstackDropZone projectId={projectId} indexes={indexes} />
        ) : null}
        {hasHierarchy ? (
          <Rail data-testid="structure-tree-rail">
            {nodes.map((node) => (
              <TreeRowBranch
                key={node.issue.id}
                node={node}
                derived={derived}
                catalog={catalog}
                indexes={indexes}
              />
            ))}
          </Rail>
        ) : null}
        <CollapsibleStructureGroup
          testId="structure-ideas-group"
          headingId="structure-ideas-group-heading"
          title="Ideas"
          nodes={ideaNodes}
          derived={derived}
          catalog={catalog}
          indexes={indexes}
        />
        <CollapsibleStructureGroup
          testId="structure-done-group"
          headingId="structure-done-group-heading"
          title="Done"
          nodes={doneNodes}
          derived={derived}
          catalog={catalog}
          indexes={indexes}
        />
      </div>
    );

  return (
    <StoryTreeDnDProvider value={dnd}>
      <RowPrStoreProvider data={prQuery.data} error={prQuery.error}>
        {body}
      </RowPrStoreProvider>
    </StoryTreeDnDProvider>
  );
}

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
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { assigneeOf } from "@server/assignee";
import { hasAttention } from "@server/kind";
import { isArchived } from "@server/services/archived-visibility";
import {
  CHILD_KIND,
  type DerivedState,
  type IssueKind,
  type IssueRecord,
  type ProjectLabel,
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
import {
  StoryTreeDnDProvider,
  useStoryTreeDnD,
  useStoryTreeDnDContext,
} from "../hooks/use-story-tree-dnd";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import type { IssueNode } from "../lib/build-tree";
import {
  EPIC_STATUS_LABEL,
  isInFlight,
  leafTaskProgressCount,
  QA_STATUS_LABEL,
  RETRO_LABEL,
  SPEC_REVIEW_LABEL,
  STORY_STATUS_LABEL,
  TASK_STATUS_LABEL,
} from "../lib/derived";
import { issuePath } from "../lib/links";
import {
  isLabelAssignableIssue,
  resolveAssignedLabels,
} from "../lib/project-labels";
import { issueRailNodeState } from "../lib/rail-state";
import { isRowDraggable } from "../lib/story-tree-dnd-logic";
import { ArchiveIssueButton } from "./archive-issue-button";
import { EpicAxisChips, StoryAxisChips } from "./axis-chips";
import { TaskStatusChips } from "./task-status-chips";
import { ProjectLabelChips } from "./project-label-chips";
import { useUpdateIssue } from "../api/mutations";

const KIND_ICON: Record<IssueKind, typeof Layers> = {
  project: FolderKanban,
  epic: Layers,
  idea: Lightbulb,
  story: GitBranch,
  task: GitCommitHorizontal,
};

/** Horizontal step per nesting level — also the x-step between a parent port and its children's. */
const TREE_INDENT = 24;
/** Port center relative to a row's own box: `Rail` pads 26px and the 12px port sits at -23. */
const PORT_CENTER_X = -17;

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
    return (
      <StoryAxisChips
        storyStatus={derived?.storyStatus}
        specReview={issue.specReview}
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
  if (issue.kind === "task" && issue.commitSha) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {issue.commitSha.slice(0, 7)}
      </span>
    );
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
function treeRowTouchChipLabels(
  issue: IssueRecord,
  derived: DerivedState | undefined,
  catalog: ProjectLabel[],
): string[] {
  const labels: string[] = [];

  if (isLabelAssignableIssue(issue)) {
    for (const label of resolveAssignedLabels(issue.labels, catalog)) {
      labels.push(label.name);
    }
  }

  if (issue.kind === "story") {
    if (derived?.storyStatus) {
      labels.push(STORY_STATUS_LABEL[derived.storyStatus]);
    }
    if (issue.specReview) {
      labels.push(`specReview: ${SPEC_REVIEW_LABEL[issue.specReview]}`);
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
    if (issue.qa) {
      labels.push(`qa: ${QA_STATUS_LABEL[issue.qa]}`);
    }
    if (issue.commitSha) {
      labels.push(issue.commitSha.slice(0, 7));
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
}: {
  issue: IssueRecord;
  derived?: DerivedState;
  catalog: ProjectLabel[];
}) {
  const openNew = useIssueUiStore((s) => s.openNew);
  const requestDelete = useIssueUiStore((s) => s.requestDelete);
  const update = useUpdateIssue();
  const childKind = CHILD_KIND[issue.kind];
  const archived = isArchived(issue);
  const chipLabels = treeRowTouchChipLabels(issue, derived, catalog);

  const toggleArchive = () => {
    if (issue.kind === "project") return;
    update.mutate({
      id: issue.id,
      patch: { archived: !archived },
    });
  };

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
      {issue.kind !== "project" ? (
        archived ? (
          <DropdownMenuItem
            disabled={update.isPending}
            onSelect={toggleArchive}
          >
            <ArchiveRestore className="h-4 w-4" />
            Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={update.isPending}
            onSelect={toggleArchive}
          >
            <Archive className="h-4 w-4" />
            Archive
          </DropdownMenuItem>
        )
      ) : null}
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={() => requestDelete(issue.id)}
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </DropdownMenuItem>
    </>
  );
}

type DerivedMap = Record<string, DerivedState>;

function TreeRow({
  node,
  derived,
  catalog,
  issues,
  guides = [],
}: {
  node: IssueNode;
  derived: DerivedMap;
  catalog: ProjectLabel[];
  issues: IssueRecord[];
  guides?: boolean[];
}) {
  const { projectId = "" } = useParams();
  const { issue } = node;
  const expanded = useIssueUiStore((s) => s.expanded[issue.id] ?? true);
  const toggle = useIssueUiStore((s) => s.toggle);
  const { getRowDnDProps, consumeDragGesture } = useStoryTreeDnDContext();
  const hasChildren = node.children.length > 0;
  const Icon = KIND_ICON[issue.kind];
  // Species, not shape: a kind that can own children reads as a container even
  // while it is still empty.
  const container = CHILD_KIND[issue.kind] !== null;
  const state = derived[issue.id];
  const blocked = Boolean(state?.blocked);
  const rowDraggable = isRowDraggable(issue, issues);
  const { isDragging, isDropTarget, ...rowDnDHandlers } = getRowDnDProps(issue);
  const assignee = assigneeOf(issue);
  const attention = hasAttention(issue) && issue.needsAttention;
  const count = leafTaskProgressCount(issue, issues);
  const railState = issueRailNodeState(issue, state);
  const live = isInFlight(issue, state);

  return (
    <>
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
                  toggle(issue.id);
                }
              : undefined
          }
        >
          {hasChildren ? (
            <TreeExpander
              expanded={expanded}
              onToggle={() => toggle(issue.id)}
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
                <TreeRowDerivedMeta issue={issue} derived={state} />
                {issue.kind === "task" ? (
                  <TaskStatusChips status={issue.status} qa={issue.qa} />
                ) : null}
                <RowActions issue={issue} />
              </>
            }
            touchMenu={
              <TreeRowTouchMenu
                issue={issue}
                derived={state}
                catalog={catalog}
              />
            }
          >
            <Link
              to={issuePath(projectId, issue.id)}
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
      {hasChildren && expanded
        ? node.children.map((child, index) => (
            <TreeRow
              key={child.issue.id}
              node={child}
              derived={derived}
              catalog={catalog}
              issues={issues}
              guides={[...guides, index < node.children.length - 1]}
            />
          ))
        : null}
    </>
  );
}

function ProjectUnstackDropZone({
  projectId,
  issues,
}: {
  projectId: string;
  issues: IssueRecord[];
}) {
  const { getProjectDnDProps, draggingId } = useStoryTreeDnDContext();
  const dragging = draggingId
    ? issues.find((issue) => issue.id === draggingId)
    : undefined;
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

export function IssueTree({
  nodes,
  derived,
  issues,
  catalog,
  projectId,
}: {
  nodes: IssueNode[];
  derived: DerivedMap;
  issues: IssueRecord[];
  catalog: ProjectLabel[];
  projectId: string;
}) {
  const dnd = useStoryTreeDnD(issues);

  if (nodes.length === 0) {
    return (
      <StoryTreeDnDProvider value={dnd}>
        <div className="flex flex-col gap-1.5">
          {projectId ? (
            <ProjectUnstackDropZone projectId={projectId} issues={issues} />
          ) : null}
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            No issues yet.
          </p>
        </div>
      </StoryTreeDnDProvider>
    );
  }
  return (
    <StoryTreeDnDProvider value={dnd}>
      <div className="flex flex-col gap-1.5">
        {projectId ? (
          <ProjectUnstackDropZone projectId={projectId} issues={issues} />
        ) : null}
        <Rail data-testid="structure-tree-rail">
          {nodes.map((node) => (
            <TreeRow
              key={node.issue.id}
              node={node}
              derived={derived}
              catalog={catalog}
              issues={issues}
            />
          ))}
        </Rail>
      </div>
    </StoryTreeDnDProvider>
  );
}

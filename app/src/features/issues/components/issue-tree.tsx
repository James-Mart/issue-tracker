import { Fragment } from "react";
import {
  ChevronDown,
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
import { Link, useParams } from "react-router-dom";
import { assigneeOf } from "@server/assignee";
import { hasAttention } from "@server/kind";
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
import { ProgressRail } from "@/components/ui/rail";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  StoryTreeDnDProvider,
  useStoryTreeDnD,
  useStoryTreeDnDContext,
} from "../hooks/use-story-tree-dnd";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import type { IssueNode } from "../lib/build-tree";
import { isIssueComplete } from "../lib/derived";
import { issuePath } from "../lib/links";
import { isRowDraggable } from "../lib/story-tree-dnd-logic";
import { ArchiveIssueButton } from "./archive-issue-button";
import { EpicAxisChips, StoryAxisChips } from "./axis-chips";
import { TaskStatusChips } from "./task-status-chips";
import { ProjectLabelChips } from "./project-label-chips";

const KIND_ICON: Record<IssueKind, typeof Layers> = {
  project: FolderKanban,
  epic: Layers,
  idea: Lightbulb,
  story: GitBranch,
  task: GitCommitHorizontal,
};

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

/** Tabular child progress (`done/total`) for OverviewRow count slot. */
function childProgressCount(
  node: IssueNode,
  derived: DerivedMap,
): string | undefined {
  const total = node.children.length;
  if (total === 0) return undefined;
  const done = node.children.filter((child) =>
    isIssueComplete(child.issue, derived[child.issue.id]),
  ).length;
  return `${done}/${total}`;
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

type DerivedMap = Record<string, DerivedState>;

function TreeRow({
  node,
  derived,
  catalog,
  issues,
}: {
  node: IssueNode;
  derived: DerivedMap;
  catalog: ProjectLabel[];
  issues: IssueRecord[];
}) {
  const { projectId = "" } = useParams();
  const { issue } = node;
  const expanded = useIssueUiStore((s) => s.expanded[issue.id] ?? true);
  const toggle = useIssueUiStore((s) => s.toggle);
  const { getRowDnDProps, consumeDragGesture } = useStoryTreeDnDContext();
  const hasChildren = node.children.length > 0;
  const Icon = KIND_ICON[issue.kind];
  const state = derived[issue.id];
  const rowDraggable = isRowDraggable(issue, issues);
  const { isDragging, isDropTarget, ...rowDnDHandlers } = getRowDnDProps(issue);
  const assignee = assigneeOf(issue);
  const attention = hasAttention(issue) && issue.needsAttention;
  const count = childProgressCount(node, derived);

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1.5",
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
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : null}
        </span>
        <OverviewRow
          className="min-w-0 flex-1"
          avatar={
            assignee ? (
              <Avatar name={assignee} size="sm" />
            ) : (
              <Icon
                aria-label={issue.kind}
                className="h-4 w-4 text-muted-foreground"
              />
            )
          }
          sparkline={<ProgressRail issue={issue} state={state} />}
          attention={attention}
          blocked={Boolean(state?.blocked)}
          count={count}
        >
          <Link
            to={issuePath(projectId, issue.id)}
            className="truncate text-inherit no-underline hover:underline"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          >
            {issue.title}
          </Link>
        </OverviewRow>
        <span
          className={cn(
            "flex shrink-0 items-center gap-2",
            "opacity-0 transition-opacity",
            "group-hover:opacity-100 group-focus-within:opacity-100",
            "focus-within:opacity-100",
          )}
        >
          <ProjectLabelChips issue={issue} catalog={catalog} />
          {issue.kind === "story" && issue.prUrl ? (
            <PrLink url={issue.prUrl} />
          ) : null}
          <TreeRowDerivedMeta issue={issue} derived={state} />
          {issue.kind === "task" ? (
            <TaskStatusChips status={issue.status} qa={issue.qa} />
          ) : null}
          <RowActions issue={issue} />
        </span>
      </div>
      {hasChildren && expanded ? (
        <div className="ml-4 border-l border-border/60 pl-2">
          {node.children.map((child) => (
            <TreeRow
              key={child.issue.id}
              node={child}
              derived={derived}
              catalog={catalog}
              issues={issues}
            />
          ))}
        </div>
      ) : null}
    </div>
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
        <div className="flex flex-col">
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
      <div className="flex flex-col">
        {projectId ? (
          <ProjectUnstackDropZone projectId={projectId} issues={issues} />
        ) : null}
        {nodes.map((node, index) => (
          <Fragment key={node.issue.id}>
            {index > 0 ? <Separator className="my-3" /> : null}
            <TreeRow
              node={node}
              derived={derived}
              catalog={catalog}
              issues={issues}
            />
          </Fragment>
        ))}
      </div>
    </StoryTreeDnDProvider>
  );
}

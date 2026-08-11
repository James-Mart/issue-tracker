import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  GitPullRequest,
  User,
} from "lucide-react";
import { hasAttention } from "@server/kind";
import type { IssueRecord } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useUpdateIssue } from "../api/mutations";
import { useProjectPullRequestsQuery } from "../api/queries";
import type { FlowItem } from "../lib/flow";
import { needsAttentionPatch } from "../lib/needs-attention-patch";
import { PrChip, storyPrChipModel, type PrChipModel } from "./pr-chip";

type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

function useFlowRowPrChip(issue: IssueRecord): PrChipModel {
  const { projectId = "" } = useParams();
  const prQuery = useProjectPullRequestsQuery(projectId);
  return storyPrChipModel(issue, prQuery);
}

function FlowRowTouchMenuPrChip({ model }: { model: PrChipModel }) {
  if (model.kind !== "chip") return null;

  return (
    <>
      <DropdownMenuItem
        disabled
        className="cursor-default opacity-100 focus:bg-transparent"
        onSelect={(event) => event.preventDefault()}
      >
        {model.label}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );
}

function ReassignDialog({
  task,
  open,
  onOpenChange,
}: {
  task: TaskRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateIssue();
  const [assigneeDraft, setAssigneeDraft] = useState(task.assignee ?? "");

  const saveAssignee = async () => {
    const trimmed = assigneeDraft.trim();
    const current = task.assignee ?? "";
    if (trimmed === current) {
      onOpenChange(false);
      return;
    }
    await update.mutateAsync({
      id: task.id,
      patch: { assignee: trimmed === "" ? null : trimmed },
    });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) setAssigneeDraft(task.assignee ?? "");
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reassign in-flight task</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void saveAssignee();
          }}
        >
          <label
            htmlFor={`flow-reassign-dialog-${task.id}`}
            className="text-xs text-muted-foreground"
          >
            Assignee
          </label>
          <Input
            id={`flow-reassign-dialog-${task.id}`}
            value={assigneeDraft}
            onChange={(event) => setAssigneeDraft(event.target.value)}
            placeholder="model or agent"
            autoFocus
            disabled={update.isPending}
          />
          <DialogFooter>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={update.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bounded Flow steering: open PR, reassign in-flight Task, toggle attention.
 * Mutations go through `useUpdateIssue`.
 */
export function FlowRowActions({
  item,
  task,
}: {
  item: FlowItem;
  task: TaskRecord | undefined;
}) {
  const prChip = useFlowRowPrChip(item.issue);
  const update = useUpdateIssue();
  const attention = hasAttention(item.issue) && item.issue.needsAttention;
  const prUrl =
    item.issue.kind === "story" ? item.issue.prUrl : undefined;
  const [reassignOpen, setReassignOpen] = useState(false);
  const [assigneeDraft, setAssigneeDraft] = useState("");

  const toggleAttention = () => {
    if (!hasAttention(item.issue)) return;
    update.mutate({
      id: item.issue.id,
      patch: needsAttentionPatch(!item.issue.needsAttention),
    });
  };

  const saveAssignee = async () => {
    if (!task) return;
    const trimmed = assigneeDraft.trim();
    const current = task.assignee ?? "";
    if (trimmed === current) {
      setReassignOpen(false);
      return;
    }
    await update.mutateAsync({
      id: task.id,
      patch: { assignee: trimmed === "" ? null : trimmed },
    });
    setReassignOpen(false);
  };

  return (
    <>
      {prUrl ? (
        <>
          <Button asChild variant="ghost" size="icon-sm" title="Open PR">
            <a href={prUrl} target="_blank" rel="noreferrer">
              <GitPullRequest className="h-3.5 w-3.5" />
            </a>
          </Button>
          <PrChip model={prChip} />
        </>
      ) : null}

      <DropdownMenu
        open={reassignOpen}
        onOpenChange={(open) => {
          setReassignOpen(open);
          if (open && task) setAssigneeDraft(task.assignee ?? "");
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            title={
              task
                ? "Reassign in-flight task"
                : "No in-flight task to reassign"
            }
            disabled={!task || update.isPending}
          >
            <User className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 p-2">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveAssignee();
            }}
          >
            <label
              htmlFor={`flow-reassign-${item.issue.id}`}
              className="text-xs text-muted-foreground"
            >
              Assignee
            </label>
            <Input
              id={`flow-reassign-${item.issue.id}`}
              value={assigneeDraft}
              onChange={(event) => setAssigneeDraft(event.target.value)}
              placeholder="model or agent"
              autoFocus
              disabled={update.isPending}
            />
            <Button
              type="submit"
              size="sm"
              variant="primary"
              disabled={update.isPending}
            >
              Save
            </Button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon-sm"
        title={attention ? "Clear needs attention" : "Flag needs attention"}
        disabled={!hasAttention(item.issue) || update.isPending}
        aria-pressed={attention}
        onClick={toggleAttention}
      >
        <AlertTriangle
          className={
            attention
              ? "h-3.5 w-3.5 [color:hsl(var(--warning))]"
              : "h-3.5 w-3.5"
          }
        />
      </Button>
    </>
  );
}

/** Flat overflow menu for coarse pointers — no nested dropdown triggers. */
export function FlowRowTouchMenu({
  item,
  task,
}: {
  item: FlowItem;
  task: TaskRecord | undefined;
}) {
  const prChip = useFlowRowPrChip(item.issue);
  const update = useUpdateIssue();
  const attention = hasAttention(item.issue) && item.issue.needsAttention;
  const prUrl =
    item.issue.kind === "story" ? item.issue.prUrl : undefined;
  const [reassignOpen, setReassignOpen] = useState(false);

  const toggleAttention = () => {
    if (!hasAttention(item.issue)) return;
    update.mutate({
      id: item.issue.id,
      patch: needsAttentionPatch(!item.issue.needsAttention),
    });
  };

  return (
    <>
      <FlowRowTouchMenuPrChip model={prChip} />
      {prUrl ? (
        <DropdownMenuItem asChild>
          <a href={prUrl} target="_blank" rel="noreferrer">
            <GitPullRequest className="h-4 w-4" />
            Open PR
          </a>
        </DropdownMenuItem>
      ) : null}
      {task ? (
        <DropdownMenuItem onSelect={() => setReassignOpen(true)}>
          <User className="h-4 w-4" />
          Reassign assignee
        </DropdownMenuItem>
      ) : null}
      {hasAttention(item.issue) ? (
        <DropdownMenuItem
          disabled={update.isPending}
          onSelect={toggleAttention}
        >
          <AlertTriangle className="h-4 w-4" />
          {attention ? "Clear needs attention" : "Flag needs attention"}
        </DropdownMenuItem>
      ) : null}
      {task ? (
        <ReassignDialog
          task={task}
          open={reassignOpen}
          onOpenChange={setReassignOpen}
        />
      ) : null}
    </>
  );
}

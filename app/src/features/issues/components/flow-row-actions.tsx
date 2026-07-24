import { useState } from "react";
import {
  AlertTriangle,
  GitPullRequest,
  MessageSquare,
  User,
} from "lucide-react";
import { Link } from "react-router-dom";
import { hasAttention } from "@server/kind";
import type { IssueRecord } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useUpdateIssue } from "../api/mutations";
import type { FlowItem } from "../lib/flow";
import { issueChatPath } from "../lib/links";
import { needsAttentionPatch } from "../lib/needs-attention-patch";

type TaskRecord = Extract<IssueRecord, { kind: "task" }>;

/**
 * Bounded Flow steering: open PR, reassign in-flight Task, toggle attention,
 * jump to chat. Mutations go through `useUpdateIssue`.
 */
export function FlowRowActions({
  item,
  projectId,
  task,
}: {
  item: FlowItem;
  projectId: string;
  task: TaskRecord | undefined;
}) {
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
        <Button asChild variant="ghost" size="icon-sm" title="Open PR">
          <a href={prUrl} target="_blank" rel="noreferrer">
            <GitPullRequest className="h-3.5 w-3.5" />
          </a>
        </Button>
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

      <Button asChild variant="ghost" size="icon-sm" title="Jump to chat">
        <Link to={issueChatPath(projectId, item.issue.id)}>
          <MessageSquare className="h-3.5 w-3.5" />
        </Link>
      </Button>
    </>
  );
}

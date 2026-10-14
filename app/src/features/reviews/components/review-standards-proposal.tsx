import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { cn } from "@/lib/utils/cn";
import { useSetStandardsProposal } from "../api/mutations";
import {
  proposalAfterText,
  proposalEditBody,
  type StandardsProposal,
} from "../lib/review-standards-ui";
import { reviewThreadExcerpt, reviewThreadLocation } from "../lib/review-thread-label";
import { StandardsProposalDiff } from "./review-standards-proposal-diff";

type Decision = NonNullable<StandardsProposal["decision"]>;

const SOURCE_LINK_CLASS =
  "inline-flex items-center rounded-sm font-mono text-[11px] text-[hsl(var(--current))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11";

const DECISION_SELECTED: Record<Decision, string> = {
  accepted:
    "border-transparent bg-success/20 [color:hsl(var(--success))] hover:border-transparent",
  rejected:
    "border-transparent bg-destructive/20 [color:hsl(var(--blocked))] hover:border-transparent",
};

function ThreadSource({
  threadId,
  thread,
  threadSearch,
}: {
  threadId: string;
  thread: CommentThread | undefined;
  threadSearch: (threadId: string) => string;
}) {
  const excerpt = thread ? reviewThreadExcerpt(thread.root.body) : "";
  return (
    <div className="flex items-start gap-2" data-testid="standards-thread-source">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-mono text-[11px] text-foreground [overflow-wrap:anywhere]">
          {thread ? reviewThreadLocation(thread.root.anchor) : threadId}
        </p>
        {excerpt ? (
          <p className="line-clamp-3 text-xs leading-snug text-muted-foreground">{excerpt}</p>
        ) : null}
      </div>
      <Button
        asChild
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-[hsl(var(--current))]"
      >
        <Link
          to={{ search: threadSearch(threadId) }}
          aria-label="Go to thread"
          data-testid="standards-go-to-thread"
        >
          <ArrowUpRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

function ProposalSourceLinks({
  proposal,
  threadsById,
  threadSearch,
}: {
  proposal: StandardsProposal;
  threadsById: ReadonlyMap<string, CommentThread>;
  threadSearch: (threadId: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted-foreground">
      <Popover>
        <PopoverTrigger className={SOURCE_LINK_CLASS} data-testid="standards-thread-link">
          {proposal.threadIds.length === 1 ? "Thread" : "Threads"}
        </PopoverTrigger>
        <PopoverContent
          aria-label="Source threads"
          className="space-y-2"
          data-testid="standards-thread-popover"
        >
          {proposal.threadIds.map((threadId) => (
            <ThreadSource
              key={threadId}
              threadId={threadId}
              thread={threadsById.get(threadId)}
              threadSearch={threadSearch}
            />
          ))}
        </PopoverContent>
      </Popover>
      <span aria-hidden>·</span>
      <Popover>
        <PopoverTrigger className={SOURCE_LINK_CLASS} data-testid="standards-rationale-link">
          Rationale
        </PopoverTrigger>
        <PopoverContent aria-label="Rationale" data-testid="standards-rationale-popover">
          <p className="text-xs leading-snug text-muted-foreground">{proposal.rationale}</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DecisionToggles({
  decision,
  disabled,
  onDecide,
}: {
  decision: Decision | undefined;
  disabled: boolean;
  onDecide: (next: Decision | null) => void;
}) {
  const toggle = (value: Decision, label: string, Icon: typeof Check) => (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      aria-pressed={decision === value}
      disabled={disabled}
      data-testid={`standards-decision-${value}`}
      className={cn(
        decision === value ? DECISION_SELECTED[value] : "text-muted-foreground hover:text-foreground",
      )}
      onClick={() => onDecide(decision === value ? null : value)}
    >
      <Icon aria-hidden />
    </Button>
  );
  return (
    <div className="flex gap-1.5" role="group" aria-label="Decision">
      {toggle("accepted", "Accept", Check)}
      {toggle("rejected", "Reject", X)}
    </div>
  );
}

/** Blur saves; Escape and the touch Cancel discard. */
function ProposedWordingEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (draft: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const closed = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);
  const close = (save: boolean) => {
    if (closed.current) return;
    closed.current = true;
    if (save) onSave(draft);
    else onCancel();
  };
  return (
    <div className="relative">
      <Textarea
        ref={fieldRef}
        aria-label="Proposed wording"
        data-testid="standards-proposal-editor"
        value={draft}
        className="min-h-20 font-mono text-xs leading-relaxed [field-sizing:content] touch:pr-14"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => close(true)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close(false);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label="Cancel edit"
        data-testid="standards-proposal-editor-cancel"
        className="absolute right-1.5 top-1.5 hidden touch:inline-flex"
        // Keep focus in the field so its blur does not save first.
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => close(false)}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

export function StandardsProposalCard({
  projectId,
  reviewId,
  submissionId,
  docFileName,
  proposal,
  editable,
  threadsById,
  threadSearch,
}: {
  projectId: string;
  reviewId: string;
  submissionId: string;
  docFileName: string;
  proposal: StandardsProposal;
  editable: boolean;
  threadsById: ReadonlyMap<string, CommentThread>;
  threadSearch: (threadId: string) => string;
}) {
  // Clicking a toggle while editing blurs the editor first, so an edit and a decision
  // can be in flight together; each keeps its own pending value on screen.
  const decide = useSetStandardsProposal(projectId);
  const edit = useSetStandardsProposal(projectId);
  const [editing, setEditing] = useState<{ initial: string } | null>(null);
  const target = { reviewId, submissionId, proposalId: proposal.id };

  const pendingDecision = decide.isPending ? decide.variables?.decision : undefined;
  const decision =
    pendingDecision === undefined ? proposal.decision : (pendingDecision ?? undefined);
  const pendingEdit = edit.isPending ? edit.variables?.editedAfter : undefined;
  const after =
    pendingEdit === undefined
      ? proposalAfterText(proposal)
      : (pendingEdit ?? proposal.after);

  const canEdit = editable && proposal.after.length > 0;
  const openEditor = useCallback(() => setEditing({ initial: after }), [after]);

  const save = (draft: string) => {
    setEditing(null);
    const body = proposalEditBody(proposal, draft);
    if (!body) return;
    edit.mutate(
      { ...target, ...body },
      { onError: () => setEditing({ initial: draft }) },
    );
  };

  return (
    <Card className="space-y-2 p-3" data-testid="standards-proposal" data-proposal-id={proposal.id}>
      <div className="space-y-0.5">
        <h4 className="text-sm font-semibold text-foreground">{proposal.section}</h4>
        <ProposalSourceLinks
          proposal={proposal}
          threadsById={threadsById}
          threadSearch={threadSearch}
        />
      </div>
      {editing ? (
        <div className="space-y-2">
          {proposal.before ? (
            <StandardsProposalDiff fileName={docFileName} before={proposal.before} after="" />
          ) : null}
          <ProposedWordingEditor
            initial={editing.initial}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <StandardsProposalDiff
          fileName={docFileName}
          before={proposal.before}
          after={after}
          onEditAdded={canEdit ? openEditor : undefined}
        />
      )}
      <DecisionToggles
        decision={decision}
        disabled={!editable || decide.isPending}
        onDecide={(next) => decide.mutate({ ...target, decision: next })}
      />
    </Card>
  );
}

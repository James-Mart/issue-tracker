import { useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { IssueDetail, IssuesResponse } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils/cn";
import {
  useRemoveStoryWorktree,
  useSetupStoryWorktree,
} from "../api/mutations";
import { useProjectWorktreesQuery } from "../api/queries";
import { type IssueSupplement } from "../hooks/use-supplemented-by-id";
import {
  WORKTREE_PARENT_BRANCH_SUFFIX,
  WORKTREE_REMOVE_ACTIVE_CONFIRM,
  WORKTREE_REMOVE_DISABLED_REASON,
  WORKTREE_SETUP_FAILED_COPY,
  worktreeCardConflict,
  worktreeCardModel,
  worktreeRemoveRetainedConfirm,
  worktreeRetainedCopy,
  type WorktreeCardKind,
  type WorktreeCardModel,
} from "../lib/worktree-card";
import { CompactMetaItem } from "./compact-meta";
import { IssueLink } from "./issue-link";
import { MetaFieldActions, META_ROW_VALUE_CONTINUATION_CLASS } from "./meta-row";
import { RemoveWorktreeConfirmDialog } from "./remove-worktree-confirm-dialog";

type StoryDetail = Extract<IssueDetail, { kind: "story" }>;

const BADGE_VARIANT: Record<
  WorktreeCardKind,
  "inProgress" | "warn" | "blocked"
> = {
  active: "inProgress",
  retained: "warn",
  "setup-failed": "blocked",
  "parent-branch": "blocked",
};

const BADGE_LABEL: Record<WorktreeCardKind, string> = {
  active: "Active",
  retained: "Retained",
  "setup-failed": "Blocked",
  "parent-branch": "Blocked",
};

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const resetCopiedRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (resetCopiedRef.current !== undefined) {
        clearTimeout(resetCopiedRef.current);
      }
    };
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title="Copy path"
      data-testid="story-worktree-copy"
      className="shrink-0 text-muted-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(path);
          setCopied(true);
          if (resetCopiedRef.current !== undefined) {
            clearTimeout(resetCopiedRef.current);
          }
          resetCopiedRef.current = setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy to clipboard");
        }
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function WorktreePath({ path }: { path: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <code
        data-testid="story-worktree-path"
        className="min-w-0 truncate font-mono text-[13px] tabular-nums"
      >
        {path}
      </code>
      <CopyPathButton path={path} />
    </div>
  );
}

function parentStoryTitle(
  stackedOn: string | undefined,
  supplement: IssueSupplement,
): string | undefined {
  if (!stackedOn) return undefined;
  return supplement.byId.get(stackedOn)?.title ?? stackedOn;
}

function RowBody({
  model,
  issue,
  supplement,
}: {
  model: WorktreeCardModel;
  issue: StoryDetail;
  supplement: IssueSupplement;
}) {
  if (model.kind === "parent-branch") {
    const title = parentStoryTitle(issue.stackedOn, supplement);
    return (
      <span
        data-testid="story-worktree-parent-branch"
        className="min-w-0 text-sm leading-snug text-muted-foreground"
      >
        {issue.stackedOn ? (
          <IssueLink
            id={issue.stackedOn}
            className="font-medium text-foreground hover:underline"
            supplement={supplement}
          >
            {title}
          </IssueLink>
        ) : (
          "The Story this one is stacked on"
        )}{" "}
        {WORKTREE_PARENT_BRANCH_SUFFIX}
      </span>
    );
  }

  if (model.kind === "setup-failed") {
    return (
      <span className="min-w-0 text-sm leading-snug text-muted-foreground">
        {WORKTREE_SETUP_FAILED_COPY}
      </span>
    );
  }

  if (model.kind === "retained") {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {model.path ? <WorktreePath path={model.path} /> : null}
        <p
          data-testid="story-worktree-retained-copy"
          className="text-sm leading-snug [color:hsl(var(--warning))]"
        >
          {worktreeRetainedCopy(
            model.uncommittedCount,
            model.atRiskCommitCount,
            model.locked,
          )}
        </p>
      </div>
    );
  }

  return <WorktreePath path={model.path} />;
}

function SetupFailedDetails({ model }: { model: Extract<WorktreeCardModel, { kind: "setup-failed" }> }) {
  return (
    <div
      className={cn(
        "grid gap-3 border-t border-border pt-2",
        META_ROW_VALUE_CONTINUATION_CLASS,
      )}
    >
      {model.path ? <WorktreePath path={model.path} /> : null}
      {model.setupOutput ? (
        <pre
          data-testid="story-worktree-setup-output"
          className="overflow-x-auto rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[12.5px] leading-relaxed"
        >
          {model.setupOutput}
        </pre>
      ) : null}
      {model.setupLogPath ? (
        <p
          data-testid="story-worktree-setup-log-path"
          className="font-mono text-[12px] tabular-nums text-muted-foreground"
        >
          {model.setupLogPath}
        </p>
      ) : null}
    </div>
  );
}

function conflictMessage(err: unknown): string | null {
  if (err instanceof ApiError && err.status === 409) return err.message;
  return null;
}

function StoryWorktreeRowInner({
  issue,
  model,
  liveRun,
  supplement,
}: {
  issue: StoryDetail;
  model: WorktreeCardModel;
  liveRun: boolean;
  supplement: IssueSupplement;
}) {
  const remove = useRemoveStoryWorktree(issue.id);
  const setup = useSetupStoryWorktree(issue.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const canRemove = model.kind === "active" || model.kind === "retained";
  const removeHeld = canRemove && liveRun;
  const pending = remove.isPending || setup.isPending;
  const removePath =
    model.kind === "active" || model.kind === "retained" || model.kind === "setup-failed"
      ? model.path
      : undefined;
  const confirmDescription =
    model.kind === "retained"
      ? worktreeRemoveRetainedConfirm(
          model.uncommittedCount,
          model.atRiskCommitCount,
        )
      : WORKTREE_REMOVE_ACTIVE_CONFIRM;
  const alertCopy = worktreeCardConflict(model, conflict);

  const postRemove = () => {
    setConfirmOpen(false);
    setConflict(null);
    remove.mutate(model.kind === "retained" ? { discard: true } : {}, {
      onError: (err) => {
        const message = conflictMessage(err);
        if (message) setConflict(message);
      },
    });
  };

  const retrySetup = () => {
    if (pending) return;
    setConflict(null);
    setup.mutate(undefined, {
      onError: (err) => {
        const message = conflictMessage(err);
        if (message) setConflict(message);
      },
    });
  };

  const removeButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-fit text-destructive"
      data-testid="story-worktree-remove"
      disabled={removeHeld || pending}
      aria-label={removeHeld ? WORKTREE_REMOVE_DISABLED_REASON : undefined}
      onClick={() => {
        if (removeHeld || pending) return;
        setConfirmOpen(true);
      }}
    >
      Remove worktree
    </Button>
  );

  const removeControl = canRemove ? (
    removeHeld ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{removeButton}</span>
        </TooltipTrigger>
        <TooltipContent>{WORKTREE_REMOVE_DISABLED_REASON}</TooltipContent>
      </Tooltip>
    ) : (
      removeButton
    )
  ) : null;

  const retryControl =
    model.kind === "setup-failed" ? (
      <Button
        type="button"
        variant="default"
        size="sm"
        data-testid="story-worktree-retry"
        disabled={pending}
        onClick={retrySetup}
      >
        <RotateCw className="h-3.5 w-3.5" />
        Retry setup
      </Button>
    ) : null;

  return (
    <div
      data-region="worktree"
      data-testid="story-worktree-row"
      data-state={model.kind}
      className="flex flex-col gap-2"
    >
      <CompactMetaItem
        label="Worktree"
        value={
          <MetaFieldActions>
            <Badge variant={BADGE_VARIANT[model.kind]} className="shrink-0">
              {BADGE_LABEL[model.kind]}
            </Badge>
            <span className="min-w-0 flex-1">
              <RowBody model={model} issue={issue} supplement={supplement} />
            </span>
            {retryControl}
            {removeControl}
          </MetaFieldActions>
        }
      />
      {model.kind === "setup-failed" ? <SetupFailedDetails model={model} /> : null}
      {alertCopy ? (
        <p
          role="alert"
          data-testid="story-worktree-conflict"
          className="text-sm text-destructive"
        >
          {alertCopy}
        </p>
      ) : null}
      {canRemove ? (
        <RemoveWorktreeConfirmDialog
          open={confirmOpen}
          path={removePath}
          description={confirmDescription}
          confirming={remove.isPending}
          onOpenChange={setConfirmOpen}
          onConfirm={postRemove}
        />
      ) : null}
    </div>
  );
}

/**
 * Worktree row with `liveRun` derived from `data.derived` — shared wiring for
 * Overview fixed panel and `GitStackPanel`.
 */
export function StoryWorktreeRowFromIssuesResponse({
  issue,
  projectId,
  supplement,
  data,
}: {
  issue: StoryDetail;
  projectId: string;
  supplement: IssueSupplement;
  data: IssuesResponse;
}) {
  return (
    <StoryWorktreeRow
      issue={issue}
      projectId={projectId}
      supplement={supplement}
      liveRun={data.derived[issue.id]?.liveRun === true}
    />
  );
}

/** Worktree checkout status and actions as one `CompactMetaItem` row. */
export function StoryWorktreeRow({
  issue,
  projectId,
  supplement,
  liveRun,
}: {
  issue: StoryDetail;
  projectId: string;
  supplement: IssueSupplement;
  liveRun: boolean;
}) {
  const { data: worktrees, isError } = useProjectWorktreesQuery(projectId);
  const storyHasCheckout =
    issue.worktreePath !== undefined ||
    issue.worktreeSetupFailed === true ||
    issue.worktreeBlockedReason !== undefined;
  if (isError && storyHasCheckout) {
    return (
      <div data-region="worktree" data-testid="story-worktree-row" className="flex flex-col gap-2">
        <CompactMetaItem
          label="Worktree"
          value={
            <span
              role="alert"
              data-testid="story-worktree-error"
              className="text-destructive"
            >
              Could not load worktree state. Reload the page.
            </span>
          }
        />
      </div>
    );
  }
  const model = worktreeCardModel(worktrees?.worktrees[issue.id]);
  if (!model) return null;

  return (
    <StoryWorktreeRowInner
      issue={issue}
      model={model}
      liveRun={liveRun}
      supplement={supplement}
    />
  );
}

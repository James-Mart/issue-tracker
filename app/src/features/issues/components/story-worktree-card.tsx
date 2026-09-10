import { useEffect, useRef, useState } from "react";
import { Check, Copy, FolderGit2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import {
  useRemoveStoryWorktree,
  useSetupStoryWorktree,
} from "../api/mutations";
import { useIssuesQuery } from "../api/queries";
import {
  WORKTREE_PARENT_BRANCH_SUFFIX,
  WORKTREE_REMOVE_ACTIVE_CONFIRM,
  WORKTREE_REMOVE_DISABLED_REASON,
  WORKTREE_SETUP_FAILED_COPY,
  worktreeCardModel,
  worktreeRemoveRetainedConfirm,
  worktreeRetainedCopy,
  type WorktreeCardKind,
  type WorktreeCardModel,
} from "../lib/worktree-card";
import { DetailEyebrow } from "./detail-section";
import { IssueLink } from "./issue-link";
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
  issues: IssueRecord[],
): string | undefined {
  if (!stackedOn) return undefined;
  return issues.find((issue) => issue.id === stackedOn)?.title ?? stackedOn;
}

function CardBody({
  model,
  issue,
  issues,
}: {
  model: WorktreeCardModel;
  issue: StoryDetail;
  issues: IssueRecord[];
}) {
  if (model.kind === "parent-branch") {
    const title = parentStoryTitle(issue.stackedOn, issues);
    return (
      <p
        data-testid="story-worktree-parent-branch"
        className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground"
      >
        {issue.stackedOn ? (
          <IssueLink
            id={issue.stackedOn}
            className="font-medium text-foreground hover:underline"
          >
            {title}
          </IssueLink>
        ) : (
          "The Story this one is stacked on"
        )}{" "}
        {WORKTREE_PARENT_BRANCH_SUFFIX}
      </p>
    );
  }

  if (model.kind === "setup-failed") {
    return (
      <div className="flex flex-col gap-3">
        <p className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
          {WORKTREE_SETUP_FAILED_COPY}
        </p>
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

  if (model.kind === "retained") {
    return (
      <div className="flex flex-col gap-2">
        {model.path ? <WorktreePath path={model.path} /> : null}
        <p
          data-testid="story-worktree-retained-copy"
          className="max-w-[52ch] text-sm leading-relaxed [color:hsl(var(--warning))]"
        >
          {worktreeRetainedCopy(
            model.uncommittedCount,
            model.atRiskCommitCount,
          )}
        </p>
      </div>
    );
  }

  return <WorktreePath path={model.path} />;
}

function conflictMessage(err: unknown): string | null {
  if (err instanceof ApiError && err.status === 409) return err.message;
  return null;
}

function StoryWorktreeCardInner({
  issue,
  model,
  issues,
  liveRun,
}: {
  issue: StoryDetail;
  model: WorktreeCardModel;
  issues: IssueRecord[];
  liveRun: boolean;
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

  return (
    <section
      data-region="worktree"
      data-testid="story-worktree-card"
      data-state={model.kind}
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card px-4 py-3.5"
    >
      <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="order-1 flex min-h-8 items-center gap-2">
          <FolderGit2
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <DetailEyebrow>Worktree</DetailEyebrow>
          <Badge variant={BADGE_VARIANT[model.kind]}>
            {BADGE_LABEL[model.kind]}
          </Badge>
        </div>
        {canRemove ? (
          <div className="order-3 flex flex-col items-start gap-1 sm:order-none sm:col-start-2 sm:row-start-1 sm:items-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit text-destructive"
              data-testid="story-worktree-remove"
              disabled={removeHeld || pending}
              aria-describedby={
                removeHeld ? "story-worktree-remove-reason" : undefined
              }
              onClick={() => {
                if (removeHeld || pending) return;
                setConfirmOpen(true);
              }}
            >
              Remove worktree
            </Button>
            {removeHeld ? (
              <p
                id="story-worktree-remove-reason"
                data-testid="story-worktree-remove-reason"
                className="max-w-[36ch] text-sm leading-relaxed text-muted-foreground sm:text-right"
              >
                {WORKTREE_REMOVE_DISABLED_REASON}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="order-2 min-w-0 sm:col-start-1">
          <CardBody model={model} issue={issue} issues={issues} />
        </div>
      </div>
      {model.kind === "setup-failed" ? (
        <Button
          type="button"
          variant="default"
          size="sm"
          className="mt-3 w-fit"
          data-testid="story-worktree-retry"
          disabled={pending}
          onClick={retrySetup}
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry setup
        </Button>
      ) : null}
      {conflict ? (
        <p
          role="alert"
          data-testid="story-worktree-conflict"
          className="mt-3 text-sm text-destructive"
        >
          {conflict}
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
    </section>
  );
}

export function StoryWorktreeCard({ issue }: { issue: StoryDetail }) {
  const { data } = useIssuesQuery();
  const model = worktreeCardModel(data?.derived[issue.id]?.worktree);
  if (!data || !model) return null;

  return (
    <StoryWorktreeCardInner
      issue={issue}
      model={model}
      issues={data.issues}
      liveRun={data.derived[issue.id]?.liveRun === true}
    />
  );
}

import { useEffect, useRef } from "react";
import { Pencil, X } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateIssue } from "../api/mutations";
import { useInlineEditSession } from "../hooks/use-inline-edit-session";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import {
  IssueLinkResolution,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";
import { isArchived } from "@server/services/archived-visibility";
import { Badge } from "@/components/ui/badge";
import {
  APPEND_TARGET_EMPTY_LABEL,
  APPEND_TARGET_MERGED,
  appendTargetCommitError,
  appendTargetFieldIsReadOnly,
} from "../lib/append-target";
import { IssueLink } from "./issue-link";
import { useAppendTargetDraftStore } from "../store/use-append-target-draft-store";
import { ExternalEditConflictBanner } from "./external-edit-conflict-banner";
import { IssueNavigateButton } from "./issue-navigate-button";
import { MetaFieldActions } from "./meta-row";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;

export function IssueAppendToField({ issue }: { issue: IdeaDetail }) {
  const update = useUpdateIssue();
  const supplement = useSupplementedById(
    issue.appendTo ? [issue.appendTo] : [],
    issue,
  );
  const { byId, missingIds, accept, reject } = supplement;
  const { data } = useIssuesWithArchived(isArchived(issue));
  const inputRef = useRef<HTMLInputElement>(null);
  const setRejected = useAppendTargetDraftStore((s) => s.setRejected);
  const derived = data?.derived?.[issue.id];
  const saved = issue.appendTo ?? "";
  const target = issue.appendTo ? byId.get(issue.appendTo) : undefined;
  const title = target?.title ?? issue.appendTo;
  const targetMerged = target?.kind === "story" && target.merged;
  const readOnly = appendTargetFieldIsReadOnly(
    issue.appendTo,
    derived,
    targetMerged,
  );

  const {
    editing,
    draft,
    error,
    saving,
    hasConflict,
    beginEdit,
    setDraft,
    commit,
    reload,
    acknowledge,
    onKeyDown,
    onBlur,
  } = useInlineEditSession({
    value: saved,
    issue,
    validate: (next) => appendTargetCommitError(next, issue.partOf, byId),
    onSave: async (next) => {
      const trimmed = next.trim();
      if (trimmed === saved) return;
      await update.mutateAsync({
        id: issue.id,
        patch: { appendTo: trimmed === "" ? null : trimmed },
      });
    },
  });

  useEffect(() => {
    setRejected(issue.id, editing && error !== null && !saved);
    return () => setRejected(issue.id, false);
  }, [editing, error, issue.id, saved, setRejected]);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  const onClear = () => {
    if (editing) {
      setDraft("");
      void commit();
      return;
    }
    if (!saved) return;
    void update.mutateAsync({
      id: issue.id,
      patch: { appendTo: null },
    });
  };

  const savedMergedReason =
    !editing && targetMerged ? APPEND_TARGET_MERGED : null;

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <IssueLinkResolution
          missingIds={missingIds}
          accept={accept}
          reject={reject}
        />
        <MetaFieldActions>
          {issue.appendTo ? (
            <IssueLink
              id={issue.appendTo}
              className="text-primary hover:underline"
              supplement={supplement}
            >
              {title}
            </IssueLink>
          ) : readOnly ? (
            <span className="text-muted-foreground">
              {APPEND_TARGET_EMPTY_LABEL}
            </span>
          ) : (
            <button
              type="button"
              className="text-left text-muted-foreground"
              onClick={beginEdit}
            >
              {APPEND_TARGET_EMPTY_LABEL}
            </button>
          )}
          {targetMerged ? (
            <Badge variant="done" data-testid="append-target-merged-badge">
              merged
            </Badge>
          ) : null}
          {issue.appendTo ? (
            <IssueNavigateButton id={issue.appendTo} supplement={supplement} />
          ) : null}
          {readOnly ? null : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground"
                aria-label="Edit append target"
                onClick={beginEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {issue.appendTo ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label="Clear append target"
                  onClick={onClear}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </>
          )}
        </MetaFieldActions>
        {savedMergedReason ? (
          <p
            data-testid="append-target-field-reason"
            className="text-sm text-destructive"
          >
            {savedMergedReason}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {hasConflict ? (
        <ExternalEditConflictBanner onReload={reload} onKeep={acknowledge} />
      ) : null}
      <div className="flex min-w-0 items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          disabled={saving}
          placeholder="Story id"
          aria-label="Append to"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className="font-mono"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label="Clear append target"
          disabled={saving}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

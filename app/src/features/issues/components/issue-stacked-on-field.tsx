import { useLayoutEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateIssue } from "../api/mutations";
import { useInlineEditSession } from "../hooks/use-inline-edit-session";
import {
  IssueLinkResolution,
  type IssueSupplement,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";
import { ExternalEditConflictBanner } from "./external-edit-conflict-banner";
import { IssueLink } from "./issue-link";
import { MetaFieldActions } from "./meta-row";

function StackedOnEditorBody({
  issue,
  supplement,
  resolveMissing,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  supplement: IssueSupplement;
  resolveMissing: boolean;
}) {
  const update = useUpdateIssue();
  const stackedId = issue.stackedOn;
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    editing,
    draft,
    error,
    saving,
    hasConflict,
    beginEdit,
    setDraft,
    reload,
    acknowledge,
    onKeyDown,
    onBlur,
  } = useInlineEditSession({
    value: stackedId ?? "",
    issue,
    async onSave(next) {
      const trimmed = next.trim();
      const current = stackedId ?? "";
      if (trimmed === current) return;
      await update.mutateAsync({
        id: issue.id,
        patch: { stackedOn: trimmed === "" ? null : trimmed },
      });
    },
  });

  useLayoutEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  if (!editing) {
    const resolution =
      resolveMissing && stackedId ? (
        <IssueLinkResolution
          missingIds={supplement.missingIds}
          accept={supplement.accept}
          reject={supplement.reject}
        />
      ) : null;

    return (
      <MetaFieldActions>
        {resolution}
        {stackedId ? (
          <IssueLink
            id={stackedId}
            className="text-primary hover:underline"
            supplement={supplement}
          >
            {supplement.byId.get(stackedId)?.title ?? stackedId}
          </IssueLink>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          title={stackedId ? "Edit stacked on" : "Stack on…"}
          aria-label={stackedId ? "Edit stacked on" : "Stack on…"}
          onClick={beginEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </MetaFieldActions>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {hasConflict ? (
        <ExternalEditConflictBanner onReload={reload} onKeep={acknowledge} />
      ) : null}
      <Input
        ref={inputRef}
        value={draft}
        disabled={saving}
        placeholder="story id"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className="font-mono"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function IssueStackedOnFieldOwned({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
}) {
  const ids = issue.stackedOn ? [issue.stackedOn] : [];
  /** Walk `stackedOn` ancestors so the supplement can resolve the fork chain. */
  const supplement = useSupplementedById(ids, undefined, undefined, true);
  return (
    <StackedOnEditorBody
      issue={issue}
      supplement={supplement}
      resolveMissing
    />
  );
}

export function IssueStackedOnField({
  issue,
  supplement,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
  supplement?: IssueSupplement;
}) {
  if (supplement) {
    return (
      <StackedOnEditorBody
        issue={issue}
        supplement={supplement}
        resolveMissing={false}
      />
    );
  }
  return <IssueStackedOnFieldOwned issue={issue} />;
}

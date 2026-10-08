import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMoveStory, useUpdateIssue } from "../api/mutations";
import { useInlineEditSession } from "../hooks/use-inline-edit-session";
import {
  IssueLinkResolution,
  type IssueSupplement,
  useSupplementedById,
} from "../hooks/use-supplemented-by-id";
import { storyPartOfOptions } from "../lib/story-partof-options";
import { ExternalEditConflictBanner } from "./external-edit-conflict-banner";
import type { InlineFieldEditContext } from "./inline-field";
import { IssueLink } from "./issue-link";
import { MetaFieldActions } from "./meta-row";
import { PartOfTargetSelect } from "./part-of-target-select";

function ParentIssueEditorView({
  issue,
  onSave,
  validate,
  renderEdit,
  supplement,
  resolve,
}: {
  issue: Extract<IssueDetail, { kind: "epic" | "story" | "task" }>;
  onSave: (next: string) => Promise<void>;
  validate?: (next: string) => string | null;
  renderEdit?: (ctx: InlineFieldEditContext) => ReactNode;
  supplement: IssueSupplement;
  resolve: boolean;
}) {
  const { byId } = supplement;
  const title = byId.get(issue.partOf)?.title ?? issue.partOf;
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    editing,
    draft,
    error,
    saving,
    hasConflict,
    beginEdit,
    setDraft,
    commit,
    cancel,
    reload,
    acknowledge,
    onKeyDown,
    onBlur,
  } = useInlineEditSession({
    value: issue.partOf,
    issue,
    onSave,
    validate,
  });

  useEffect(() => {
    if (!editing || renderEdit) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing, renderEdit]);

  if (!editing) {
    return (
      <MetaFieldActions>
        {resolve ? (
          <IssueLinkResolution
            missingIds={supplement.missingIds}
            accept={supplement.accept}
            reject={supplement.reject}
          />
        ) : null}
        <IssueLink
          id={issue.partOf}
          className="text-primary hover:underline"
          supplement={supplement}
        >
          {title}
        </IssueLink>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label="Edit parent issue"
          onClick={beginEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </MetaFieldActions>
    );
  }

  const editCtx: InlineFieldEditContext = {
    draft,
    setDraft,
    saving,
    error,
    hasConflict,
    commit,
    cancel,
    reload,
    acknowledge,
    onKeyDown,
    onBlur,
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {hasConflict ? (
        <ExternalEditConflictBanner onReload={reload} onKeep={acknowledge} />
      ) : null}
      {renderEdit ? (
        renderEdit(editCtx)
      ) : (
        <Input
          ref={inputRef}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className="font-mono"
        />
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function ParentIssueEditorOwned(
  props: Omit<
    Parameters<typeof ParentIssueEditorView>[0],
    "supplement" | "resolve"
  >,
) {
  const supplement = useSupplementedById(
    [props.issue.partOf],
    undefined,
    undefined,
    true,
  );
  return (
    <ParentIssueEditorView {...props} supplement={supplement} resolve />
  );
}

function ParentIssueEditor({
  supplement,
  ...props
}: Omit<
  Parameters<typeof ParentIssueEditorView>[0],
  "supplement" | "resolve"
> & { supplement?: IssueSupplement }) {
  if (supplement) {
    return (
      <ParentIssueEditorView
        {...props}
        supplement={supplement}
        resolve={false}
      />
    );
  }
  return <ParentIssueEditorOwned {...props} />;
}

function StoryPartOfField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
}) {
  const moveStory = useMoveStory();
  const supplement = useSupplementedById(
    [issue.id, issue.partOf],
    issue,
    undefined,
    true,
  );
  const { byId, missingIds, accept, reject } = supplement;
  const options = useMemo(
    () => storyPartOfOptions(issue, [...byId.values()]),
    [issue, byId],
  );

  return (
    <>
    <IssueLinkResolution
      missingIds={missingIds}
      accept={accept}
      reject={reject}
    />
    <ParentIssueEditor
      issue={issue}
      supplement={supplement}
      onSave={async (next) => {
        const trimmed = next.trim();
        if (!trimmed || trimmed === issue.partOf) return;
        await moveStory.mutateAsync({ id: issue.id, target: trimmed });
      }}
      renderEdit={({ draft, setDraft, commit, cancel, saving, hasConflict }) => (
        <>
          <PartOfTargetSelect
            value={draft}
            disabled={saving || hasConflict}
            onValueChange={(value) => {
              setDraft(value);
              void commit();
            }}
            options={options}
            placeholder="Select Project or Epic"
          />
          <button
            type="button"
            className="self-start text-xs text-muted-foreground hover:text-foreground"
            disabled={saving}
            onClick={cancel}
          >
            Cancel
          </button>
        </>
      )}
    />
    </>
  );
}

export function IssuePartOfField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "epic" | "story" | "task" }>;
}) {
  const update = useUpdateIssue();

  if (issue.kind === "story") {
    return <StoryPartOfField issue={issue} />;
  }

  return (
    <ParentIssueEditor
      issue={issue}
      validate={(next) => (next.trim() ? null : "Parent issue cannot be empty")}
      onSave={async (next) => {
        const trimmed = next.trim();
        if (trimmed === issue.partOf) return;
        await update.mutateAsync({
          id: issue.id,
          patch: { partOf: trimmed },
        });
      }}
    />
  );
}

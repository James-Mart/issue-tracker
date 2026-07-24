import { useMemo } from "react";
import type { IssueDetail } from "@server/schemas";
import { useMoveStory, useUpdateIssue } from "../api/mutations";
import { useIssuesQuery } from "../api/queries";
import { storyPartOfOptions } from "../lib/story-partof-options";
import { InlineField } from "./inline-field";
import { IssueNavigateButton } from "./issue-navigate-button";
import { PartOfTargetSelect } from "./part-of-target-select";

function StoryPartOfField({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "story" }>;
}) {
  const moveStory = useMoveStory();
  const { data } = useIssuesQuery();
  const options = useMemo(
    () => storyPartOfOptions(issue, data?.issues ?? []),
    [issue, data?.issues],
  );

  return (
    <InlineField
      value={issue.partOf}
      issue={issue}
      emptyLabel="Unset"
      displayClassName="font-mono"
      trailingDisplay={
        issue.partOf ? <IssueNavigateButton id={issue.partOf} /> : null
      }
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
    <InlineField
      value={issue.partOf}
      issue={issue}
      emptyLabel="Unset"
      displayClassName="font-mono"
      inputClassName="font-mono"
      validate={(next) => (next.trim() ? null : "Part of cannot be empty")}
      trailingDisplay={
        issue.partOf ? <IssueNavigateButton id={issue.partOf} /> : null
      }
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

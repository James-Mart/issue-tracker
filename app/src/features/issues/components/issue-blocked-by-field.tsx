import type { DerivedState, IssueDetail } from "@server/schemas";
import { epicIsDone } from "@server/services/derive";
import { useUpdateIssue } from "../api/mutations";
import { blockedByFormValue, parseIds } from "../lib/issue-detail-form";
import { InlineField } from "./inline-field";
import { IssueNavigateButton } from "./issue-navigate-button";

function sameIds(a: string[], b: string[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function IssueBlockedByField({
  issue,
  derived,
}: {
  issue: Extract<IssueDetail, { kind: "epic" }>;
  derived: Record<string, DerivedState>;
}) {
  const update = useUpdateIssue();

  return (
    <InlineField
      value={blockedByFormValue(issue)}
      issue={issue}
      emptyLabel="nothing"
      placeholder="space-separated epic ids"
      displayClassName="font-mono"
      inputClassName="font-mono"
      richDisplay
      onSave={async (next) => {
        const ids = parseIds(next);
        if (sameIds(ids, issue.blockedBy)) return;
        await update.mutateAsync({
          id: issue.id,
          patch: { blockedBy: ids },
        });
      }}
      renderDisplayContent={() =>
        issue.blockedBy.length > 0 ? (
          <span className="flex flex-col gap-1">
            {issue.blockedBy.map((depId) => {
              const done = epicIsDone(derived[depId]);
              return (
                <span key={depId} className="flex items-center gap-1">
                  <span className="font-mono">{depId}</span>
                  <IssueNavigateButton id={depId} />
                  <span
                    className={
                      done
                        ? "text-xs [color:hsl(var(--success))]"
                        : "text-xs [color:hsl(var(--warning))]"
                    }
                  >
                    {done ? "done" : "pending"}
                  </span>
                </span>
              );
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">nothing</span>
        )
      }
    />
  );
}

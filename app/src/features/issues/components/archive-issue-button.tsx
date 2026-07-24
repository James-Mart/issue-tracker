import { Archive, ArchiveRestore } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { isArchived } from "@server/services/archived-visibility";
import { Button } from "@/components/ui/button";
import { useUpdateIssue } from "../api/mutations";

export function ArchiveIssueButton({
  issue,
  compact = false,
}: {
  issue: IssueRecord;
  compact?: boolean;
}) {
  const update = useUpdateIssue();
  if (issue.kind === "project") return null;

  const archived = isArchived(issue);
  const label = archived ? "Unarchive" : "Archive";

  return (
    <Button
      variant={compact ? "ghost" : "outline"}
      size={compact ? "icon-sm" : "sm"}
      title={label}
      disabled={update.isPending}
      onClick={(e) => {
        e.stopPropagation();
        update.mutate({
          id: issue.id,
          patch: { archived: !archived },
        });
      }}
    >
      {archived ? (
        <ArchiveRestore className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      ) : (
        <Archive className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      )}
      {compact ? null : label}
    </Button>
  );
}

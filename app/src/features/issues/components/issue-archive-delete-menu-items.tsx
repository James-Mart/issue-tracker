import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import type { IssueRecord } from "@server/schemas";
import { isArchived } from "@server/services/archived-visibility";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useUpdateIssue } from "../api/mutations";
import { useIssueUiStore } from "../store/use-issue-ui-store";

/** Shared Archive/Unarchive + destructive Delete items for issue overflow menus. */
export function IssueArchiveDeleteMenuItems({ issue }: { issue: IssueRecord }) {
  const requestDelete = useIssueUiStore((s) => s.requestDelete);
  const update = useUpdateIssue();
  const archived = isArchived(issue);

  const toggleArchive = () => {
    if (issue.kind === "project") return;
    update.mutate({
      id: issue.id,
      patch: { archived: !archived },
    });
  };

  return (
    <>
      {issue.kind !== "project" ? (
        archived ? (
          <DropdownMenuItem
            disabled={update.isPending}
            onSelect={toggleArchive}
          >
            <ArchiveRestore className="h-4 w-4" />
            Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={update.isPending}
            onSelect={toggleArchive}
          >
            <Archive className="h-4 w-4" />
            Archive
          </DropdownMenuItem>
        )
      ) : null}
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={() => requestDelete(issue.id)}
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </DropdownMenuItem>
    </>
  );
}

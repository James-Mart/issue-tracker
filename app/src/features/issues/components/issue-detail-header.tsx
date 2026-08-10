import { useEffect, useRef, useState } from "react";
import { Check, Copy, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { IssueDetail, ProjectLabel } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KIND_LABEL } from "../lib/kind";
import { IssueArchiveDeleteMenuItems } from "./issue-archive-delete-menu-items";
import { CommentsAnchor } from "./comments/comments-anchor";
import { IssueBadges } from "./issue-badges";
import { IssueDetailStatusChips } from "./issue-detail-status-chips";
import { IssueTitleField } from "./issue-title-field";
import { ProjectLabelChips } from "./project-label-chips";

function CopyIssueIdButton({ id }: { id: string }) {
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
      variant="ghost"
      size="icon-sm"
      title="Copy id"
      className="shrink-0 text-muted-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
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

/**
 * Mainline detail header: kind eyebrow, title, Foundations status chips,
 * comments anchor (warn when flagged), labels, badges, and a quiet overflow menu.
 */
export function IssueDetailHeader({
  issue,
  catalog,
}: {
  issue: IssueDetail;
  catalog: ProjectLabel[];
}) {
  // Stories carry specReview/retro on axis chips — keep badges compact to avoid dupes.
  const badgesCompact = issue.kind === "story";

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
          {KIND_LABEL[issue.kind]}
        </p>
        <IssueTitleField issue={issue} />
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="inline-flex items-center gap-0.5">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {issue.id}
            </span>
            <CopyIssueIdButton id={issue.id} />
          </span>
          <CommentsAnchor issue={issue} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <IssueDetailStatusChips issue={issue} />
          <ProjectLabelChips issue={issue} catalog={catalog} />
          <IssueBadges issue={issue} compact={badgesCompact} />
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            title="Issue actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <IssueArchiveDeleteMenuItems issue={issue} />
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

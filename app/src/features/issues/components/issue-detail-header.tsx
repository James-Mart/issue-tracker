import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { IssueDetail, ProjectLabel } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { KIND_LABEL } from "../lib/kind";
import { projectPath } from "../lib/links";
import { ArchiveIssueButton } from "./archive-issue-button";
import { IssueBadges } from "./issue-badges";
import { IssueDetailStatusChips } from "./issue-detail-status-chips";
import { IssueTitleField } from "./issue-title-field";
import { ProjectLabelChips } from "./project-label-chips";

function CopyIssueIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const resetCopiedRef = useRef<ReturnType<typeof window.setTimeout>>();

  useEffect(() => {
    return () => {
      if (resetCopiedRef.current !== undefined) {
        window.clearTimeout(resetCopiedRef.current);
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
            window.clearTimeout(resetCopiedRef.current);
          }
          resetCopiedRef.current = window.setTimeout(() => setCopied(false), 1500);
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
 * needs-attention (via IssueBadges), labels, and archive/delete.
 */
export function IssueDetailHeader({
  issue,
  projectId,
  catalog,
}: {
  issue: IssueDetail;
  projectId: string;
  catalog: ProjectLabel[];
}) {
  const navigate = useNavigate();
  const requestDelete = useIssueUiStore((s) => s.requestDelete);
  // Stories carry specReview/retro on axis chips — keep badges compact to avoid dupes.
  const badgesCompact = issue.kind === "story";

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
          {KIND_LABEL[issue.kind]}
        </p>
        <IssueTitleField issue={issue} />
        <div className="mt-0.5 flex items-center gap-0.5">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {issue.id}
          </span>
          <CopyIssueIdButton id={issue.id} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <IssueDetailStatusChips issue={issue} />
          <ProjectLabelChips issue={issue} catalog={catalog} />
          <IssueBadges issue={issue} compact={badgesCompact} />
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <ArchiveIssueButton issue={issue} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            requestDelete(issue.id);
            navigate(projectPath(projectId));
          }}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </header>
  );
}

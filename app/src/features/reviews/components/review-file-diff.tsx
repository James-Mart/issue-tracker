import { useId, type Ref } from "react";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { ChevronRight } from "lucide-react";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/cn";
import { DiffLineCounts } from "@/features/issues/components/changed-file-row";
import { useFileDiffContentsLoader } from "@/features/issues/hooks/use-file-diff-contents-loader";
import type { DiffLayout } from "@/features/issues/lib/diff-layout-preference";
import type { ReviewFileRow } from "../lib/review-files";
import { ChangedSinceReviewedBadge } from "./changed-since-reviewed-badge";

export type ReviewFileDiffSource = {
  storyId: string;
  tip: string;
  contentsCache: Map<string, Promise<string>>;
};

function FileTooLargeBody({ localCommand }: { localCommand: string }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4" data-testid="review-file-too-large">
      <p className="text-sm font-semibold text-foreground">
        This file is too large to render in the browser.
      </p>
      <p className="text-sm text-muted-foreground">
        Read it in the project workspace with git diff from the merge base
        through the Story tip.
      </p>
      <code className="block break-all rounded-md border border-border bg-[hsl(var(--panel-2))] px-3 py-1.5 font-mono text-xs text-foreground">
        {localCommand}
      </code>
    </div>
  );
}

function RenderedFileDiff({
  fileDiff,
  diffLayout,
  source,
}: {
  fileDiff: FileDiffMetadata;
  diffLayout: DiffLayout;
  source: ReviewFileDiffSource;
}) {
  const { loading, loadDiffFiles } = useFileDiffContentsLoader({
    issueId: source.storyId,
    sha: source.tip,
    cache: source.contentsCache,
  });

  return (
    <div data-context-loading={loading ? "true" : undefined}>
      {loading ? (
        <p
          className="border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
          role="status"
        >
          Loading context…
        </p>
      ) : null}
      <FileDiff
        fileDiff={fileDiff}
        disableWorkerPool
        options={{ loadDiffFiles, diffStyle: diffLayout, disableFileHeader: true }}
      />
    </div>
  );
}

export function ReviewFileDiff({
  row,
  fileDiff,
  collapsed,
  readOnly,
  diffLayout,
  source,
  localCommand,
  onToggleCollapsed,
  onReviewedChange,
  fileRef,
}: {
  row: ReviewFileRow;
  /** Absent for a too-large file, whose section the server drops from the patch. */
  fileDiff: FileDiffMetadata | undefined;
  collapsed: boolean;
  readOnly: boolean;
  diffLayout: DiffLayout;
  source: ReviewFileDiffSource;
  localCommand: string;
  onToggleCollapsed: () => void;
  onReviewedChange: (reviewed: boolean) => void;
  fileRef?: Ref<HTMLElement>;
}) {
  const { file, reviewed, changedSinceReviewed } = row;
  const checkboxId = useId();
  const bodyId = useId();

  return (
    <section
      ref={fileRef}
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
      data-testid="review-file"
      data-file-name={file.path}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={file.path}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
          data-testid="review-file-toggle"
          onClick={onToggleCollapsed}
        >
          <ChevronRight
            className={cn("transition-transform", !collapsed && "rotate-90")}
          />
        </Button>
        {/* Below the shell breakpoint the path owns the first line and the controls wrap under it. */}
        <span
          className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] truncate font-mono text-[12px] text-foreground shell:basis-0"
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        >
          {file.oldPath ? (
            <span className="text-muted-foreground">{file.oldPath} → </span>
          ) : null}
          {file.path}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {changedSinceReviewed ? <ChangedSinceReviewedBadge /> : null}
          <DiffLineCounts
            additions={file.additions}
            deletions={file.deletions}
            className="font-mono text-[12px]"
          />
          <span
            className="flex items-center gap-1.5"
            title={readOnly ? "Reopen the review to change marks" : undefined}
          >
            <Checkbox
              id={checkboxId}
              checked={reviewed}
              disabled={readOnly}
              data-testid="review-file-reviewed"
              onCheckedChange={(next) => onReviewedChange(next === true)}
            />
            <label
              htmlFor={checkboxId}
              className={cn(
                "text-xs text-muted-foreground",
                readOnly ? "cursor-not-allowed opacity-70" : "cursor-pointer",
              )}
            >
              Reviewed
            </label>
          </span>
        </span>
      </header>
      {collapsed ? null : (
        <div id={bodyId} className="border-t border-border">
          {file.tooLarge ? (
            <FileTooLargeBody localCommand={localCommand} />
          ) : fileDiff ? (
            <RenderedFileDiff
              fileDiff={fileDiff}
              diffLayout={diffLayout}
              source={source}
            />
          ) : (
            <ShellInlineFault
              className="m-3"
              message={`No patch section for ${file.path}`}
              hint="Reload the review; the diff and its file list disagree."
            />
          )}
        </div>
      )}
    </section>
  );
}

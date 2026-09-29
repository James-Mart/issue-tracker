import { useId, useRef, type MutableRefObject, type Ref } from "react";
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
import type { DiffSearchMatch } from "../lib/review-diff-search";
import { REVIEW_SEARCH_MATCH_CSS } from "../lib/review-diff-search-mark";
import { usePinnedHeaderCollapse } from "../hooks/use-pinned-header-collapse";
import { useReviewSearchMark } from "../hooks/use-review-search-mark";
import { ChangedSinceReviewedHeaderMark } from "./changed-since-reviewed-badge";
import { MarkedPathText } from "./review-search-marked-text";

export type ReviewFileDiffSource = {
  storyId: string;
  /** Commit whose tree holds the file's post-image. The tip for "All changes". */
  sha: string;
  contentsCache: Map<string, Promise<string>>;
};

function FileTooLargeBody({
  localCommand,
  localHint,
}: {
  localCommand: string;
  localHint: string;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-4" data-testid="review-file-too-large">
      <p className="text-sm font-semibold text-foreground">
        This file is too large to render in the browser.
      </p>
      <p className="text-sm text-muted-foreground">{localHint}</p>
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
    sha: source.sha,
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
        options={{
          loadDiffFiles,
          diffStyle: diffLayout,
          disableFileHeader: true,
          unsafeCSS: REVIEW_SEARCH_MATCH_CSS,
        }}
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
  localHint,
  onToggleCollapsed,
  onReviewedChange,
  fileRef,
  searchNeedle = "",
  currentMatch,
}: {
  row: ReviewFileRow;
  /** Absent for a too-large file, whose section the server drops from the patch. */
  fileDiff: FileDiffMetadata | undefined;
  collapsed: boolean;
  readOnly: boolean;
  diffLayout: DiffLayout;
  source: ReviewFileDiffSource;
  localCommand: string;
  localHint: string;
  onToggleCollapsed: () => void;
  onReviewedChange: (reviewed: boolean) => void;
  fileRef?: Ref<HTMLElement>;
  searchNeedle?: string;
  currentMatch?: DiffSearchMatch;
}) {
  const { file, reviewed, changedSinceReviewed } = row;
  const checkboxId = useId();
  const bodyId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  useReviewSearchMark(sectionRef, currentMatch, searchNeedle, collapsed);
  const holdPinnedFile = usePinnedHeaderCollapse(sectionRef, collapsed);
  const pathOccurrence =
    currentMatch?.kind === "path" && currentMatch.field === "path"
      ? currentMatch.occurrence
      : undefined;
  const oldPathOccurrence =
    currentMatch?.kind === "path" && currentMatch.field === "oldPath"
      ? currentMatch.occurrence
      : undefined;

  return (
    <section
      ref={(node) => {
        sectionRef.current = node;
        if (typeof fileRef === "function") fileRef(node);
        else if (fileRef) (fileRef as MutableRefObject<HTMLElement | null>).current = node;
      }}
      data-search-current={currentMatch ? "true" : undefined}
      // Clip rather than hide overflow: a hidden-overflow section becomes the header's scroll container and stops it pinning.
      className="min-w-0 overflow-clip rounded-lg border border-border bg-card"
      data-testid="review-file"
      data-file-name={file.path}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={file.path}
    >
      <header
        className={cn(
          "sticky top-0 z-10 flex min-w-0 flex-nowrap items-center gap-x-1 bg-card px-2 py-1.5 shell:flex-wrap shell:gap-x-2 shell:gap-y-1",
          !collapsed && "border-b border-border",
        )}
        data-testid="review-file-header"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? `Expand ${file.path}` : `Collapse ${file.path}`}
          data-testid="review-file-toggle"
          onClick={() => {
            holdPinnedFile();
            onToggleCollapsed();
          }}
        >
          <ChevronRight
            className={cn("transition-transform", !collapsed && "rotate-90")}
          />
        </Button>
        <span
          className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-foreground [direction:rtl] shell:[direction:ltr]"
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        >
          {file.oldPath ? (
            <span className="hidden text-muted-foreground shell:inline">
              <MarkedPathText
                text={file.oldPath}
                needle={searchNeedle}
                occurrence={oldPathOccurrence}
              />
              {" → "}
            </span>
          ) : null}
          <MarkedPathText text={file.path} needle={searchNeedle} occurrence={pathOccurrence} />
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 shell:gap-2">
          {changedSinceReviewed ? <ChangedSinceReviewedHeaderMark /> : null}
          <DiffLineCounts
            additions={file.additions}
            deletions={file.deletions}
            className="hidden font-mono text-[12px] shell:inline"
            data-testid="review-file-line-counts"
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
              onCheckedChange={(next) => {
                if (next === true) holdPinnedFile();
                onReviewedChange(next === true);
              }}
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
        <div id={bodyId}>
          {file.tooLarge ? (
            <FileTooLargeBody localCommand={localCommand} localHint={localHint} />
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

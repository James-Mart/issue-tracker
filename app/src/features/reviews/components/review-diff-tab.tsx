import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Virtualizer, type FileDiffMetadata } from "@pierre/diffs/react";
import type { ReviewCommits, ReviewDiff, ReviewView } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { DiffLineCounts } from "@/features/issues/components/changed-file-row";
import { DiffLayoutToggle } from "@/features/issues/components/diff-layout-toggle";
import { useDiffLayoutPreference } from "@/features/issues/hooks/use-diff-layout-preference";
import { useVirtualizedFileScroll } from "@/features/issues/hooks/use-virtualized-file-scroll";
import type { DiffLayout } from "@/features/issues/lib/diff-layout-preference";
import { fileDiffsFromPatch } from "@/features/issues/lib/issue-change-file-diffs";
import { useReviewFileMarks } from "../hooks/use-review-file-marks";
import {
  diffLineTotals,
  fileCountLabel,
  fileTooLargeHint,
  localFileDiffCommand,
  type ReviewFileRow,
} from "../lib/review-files";
import {
  adjacentReviewScope,
  ALL_CHANGES_SCOPE,
  reviewScopeLabel,
  reviewScopeSequence,
  type ReviewMarkOverrides,
} from "../lib/review-scope";
import { ReviewFileDiff, type ReviewFileDiffSource } from "./review-file-diff";
import { ReviewFileTree } from "./review-file-tree";

type ScrollRequest = { path: string; nonce: number; scope: string };

function ScopeStep({
  label,
  direction,
  target,
  onScopeChange,
}: {
  label: string;
  direction: "previous" | "next";
  target: string | undefined;
  onScopeChange: (scope: string) => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0 text-muted-foreground"
      aria-label={label}
      data-testid={
        direction === "previous" ? "review-scope-previous" : "review-scope-next"
      }
      disabled={target === undefined}
      onClick={target === undefined ? undefined : () => onScopeChange(target)}
    >
      <Icon />
    </Button>
  );
}

function DiffControls({
  rows,
  commits,
  scope,
  onScopeChange,
  layout,
  showLayoutToggle,
  onLayoutChange,
}: {
  rows: ReviewFileRow[];
  commits: ReviewCommits;
  scope: string;
  onScopeChange: (scope: string) => void;
  layout: DiffLayout;
  showLayoutToggle: boolean;
  onLayoutChange: (layout: DiffLayout) => void;
}) {
  const files = rows.map((row) => row.file);
  const totals = diffLineTotals(files);
  const reviewed = rows.filter((row) => row.reviewed).length;
  const sequence = reviewScopeSequence(commits.commits);
  const label = reviewScopeLabel(scope, commits.commits);
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2"
      data-testid="review-diff-controls"
    >
      <div className="flex min-w-0 basis-full items-center gap-1 shell:basis-auto shell:max-w-[min(100%,36rem)]">
        <ScopeStep
          label="Previous commit"
          direction="previous"
          target={adjacentReviewScope(sequence, scope, -1)}
          onScopeChange={onScopeChange}
        />
        <p
          className="min-w-0 flex-1 truncate text-center font-mono text-[11px] text-foreground shell:text-left"
          data-testid="review-scope-label"
          title={label}
        >
          {label}
        </p>
        <ScopeStep
          label="Next commit"
          direction="next"
          target={adjacentReviewScope(sequence, scope, 1)}
          onScopeChange={onScopeChange}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {fileCountLabel(files.length)} <DiffLineCounts {...totals} />
        </p>
        <p
          className="font-mono text-[11px] tabular-nums text-muted-foreground"
          data-testid="review-progress"
          aria-live="polite"
        >
          {reviewed} / {files.length} files reviewed
        </p>
        {showLayoutToggle ? (
          <DiffLayoutToggle layout={layout} onLayoutChange={onLayoutChange} />
        ) : null}
      </div>
    </div>
  );
}

function ReviewFileStack({
  rows,
  fileDiffs,
  isCollapsed,
  readOnly,
  diffLayout,
  source,
  mergeBaseRef,
  scope,
  localHint,
  scrollRequest,
  onToggleCollapsed,
  onReviewedChange,
}: {
  rows: ReviewFileRow[];
  fileDiffs: Map<string, FileDiffMetadata>;
  isCollapsed: (row: ReviewFileRow) => boolean;
  readOnly: boolean;
  diffLayout: DiffLayout;
  source: ReviewFileDiffSource;
  mergeBaseRef: string;
  scope: string;
  localHint: string;
  scrollRequest: ScrollRequest | undefined;
  onToggleCollapsed: (row: ReviewFileRow) => void;
  onReviewedChange: (path: string, reviewed: boolean) => void;
}) {
  const fileRef = useVirtualizedFileScroll<HTMLElement>(
    scrollRequest?.path,
    scrollRequest?.nonce,
  );

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <ReviewFileDiff
          key={row.file.path}
          fileRef={fileRef(row.file.path)}
          row={row}
          fileDiff={fileDiffs.get(row.file.path)}
          collapsed={isCollapsed(row)}
          readOnly={readOnly}
          diffLayout={diffLayout}
          source={source}
          localCommand={localFileDiffCommand(mergeBaseRef, source.sha, row.file.path, scope)}
          localHint={localHint}
          onToggleCollapsed={() => onToggleCollapsed(row)}
          onReviewedChange={(next) => onReviewedChange(row.file.path, next)}
        />
      ))}
    </div>
  );
}

export function ReviewDiffTab({
  projectId,
  storyId,
  review,
  diff,
  commits,
  scope,
  onScopeChange,
  overrides,
  setOverrides,
}: {
  projectId: string;
  storyId: string;
  review: ReviewView;
  diff: ReviewDiff;
  commits: ReviewCommits;
  scope: string;
  onScopeChange: (scope: string) => void;
  overrides: ReviewMarkOverrides;
  setOverrides: Dispatch<SetStateAction<ReviewMarkOverrides>>;
}) {
  const { layout, setLayout, diffLayout, isMobile } = useDiffLayoutPreference();
  const { rows, isCollapsed, toggleCollapsed, setReviewed } = useReviewFileMarks(
    projectId,
    review,
    diff.files,
    scope,
    overrides,
    setOverrides,
  );
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest>();
  const activeScroll = scrollRequest?.scope === scope ? scrollRequest : undefined;
  const contentsCache = useRef(new Map<string, Promise<string>>()).current;

  const fileDiffs = useMemo(
    () => new Map(fileDiffsFromPatch(diff.patch).map((file) => [file.name, file])),
    [diff.patch],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3" data-testid="review-diff-tab">
      <DiffControls
        rows={rows}
        commits={commits}
        scope={scope}
        onScopeChange={onScopeChange}
        layout={layout}
        showLayoutToggle={!isMobile}
        onLayoutChange={setLayout}
      />
      {rows.length === 0 ? (
        <ShellState
          className="border-0 bg-transparent px-4 py-8 shadow-none"
          eyebrow="Diff"
          title="No file changes in this scope."
          detail={
            scope === ALL_CHANGES_SCOPE
              ? "The Story's commits net out to no difference from the merge base."
              : "This commit does not change any files."
          }
        />
      ) : null}
      {/* A third column to the right of the stack is reserved for future review tools. */}
      {rows.length > 0 ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 shell:flex-row">
          <ReviewFileTree
            rows={rows}
            selectedPath={activeScroll?.path}
            onSelect={(path) =>
              setScrollRequest((prev) => ({
                path,
                scope,
                nonce: (prev?.nonce ?? 0) + 1,
              }))
            }
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="review-diff-stack">
            <Virtualizer className="max-h-[75svh] overflow-auto shell:max-h-none shell:min-h-0 shell:flex-1">
              <ReviewFileStack
                rows={rows}
                fileDiffs={fileDiffs}
                isCollapsed={isCollapsed}
                readOnly={review.effectiveStatus === "archived"}
                diffLayout={diffLayout}
                source={{
                  storyId,
                  sha: scope === ALL_CHANGES_SCOPE ? commits.tip : scope,
                  contentsCache,
                }}
                mergeBaseRef={commits.mergeBaseRef}
                scope={scope}
                localHint={fileTooLargeHint(scope)}
                scrollRequest={activeScroll}
                onToggleCollapsed={toggleCollapsed}
                onReviewedChange={setReviewed}
              />
            </Virtualizer>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { useMemo, useRef, useState } from "react";
import { Virtualizer, type FileDiffMetadata } from "@pierre/diffs/react";
import type { ReviewCommits, ReviewDiff, ReviewView } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { DiffLineCounts } from "@/features/issues/components/changed-file-row";
import { DiffLayoutToggle } from "@/features/issues/components/diff-layout-toggle";
import { useDiffLayoutPreference } from "@/features/issues/hooks/use-diff-layout-preference";
import { useVirtualizedFileScroll } from "@/features/issues/hooks/use-virtualized-file-scroll";
import type { DiffLayout } from "@/features/issues/lib/diff-layout-preference";
import { fileDiffsFromPatch } from "@/features/issues/lib/issue-change-file-diffs";
import { useReviewFileMarks } from "../hooks/use-review-file-marks";
import {
  diffLineTotals,
  localFileDiffCommand,
  type ReviewFileRow,
} from "../lib/review-files";
import { ReviewFileDiff, type ReviewFileDiffSource } from "./review-file-diff";
import { ReviewFileTree } from "./review-file-tree";

type ScrollRequest = { path: string; nonce: number };

function DiffControls({
  rows,
  layout,
  showLayoutToggle,
  onLayoutChange,
}: {
  rows: ReviewFileRow[];
  layout: DiffLayout;
  showLayoutToggle: boolean;
  onLayoutChange: (layout: DiffLayout) => void;
}) {
  const files = rows.map((row) => row.file);
  const totals = diffLineTotals(files);
  const reviewed = rows.filter((row) => row.reviewed).length;
  const fileLabel = files.length === 1 ? "1 file" : `${files.length} files`;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2"
      data-testid="review-diff-controls"
    >
      <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] tabular-nums text-muted-foreground">
        <span className="text-foreground">All changes</span>
        <span>
          {fileLabel} <DiffLineCounts {...totals} />
        </span>
      </p>
      <div className="flex items-center gap-3">
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
          localCommand={localFileDiffCommand(mergeBaseRef, source.tip, row.file.path)}
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
}: {
  projectId: string;
  storyId: string;
  review: ReviewView;
  diff: ReviewDiff;
  commits: ReviewCommits;
}) {
  const { layout, setLayout, diffLayout, isMobile } = useDiffLayoutPreference();
  const { rows, isCollapsed, toggleCollapsed, setReviewed } = useReviewFileMarks(
    projectId,
    review,
    diff.files,
  );
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest>();
  const contentsCache = useRef(new Map<string, Promise<string>>()).current;

  const fileDiffs = useMemo(
    () => new Map(fileDiffsFromPatch(diff.patch).map((file) => [file.name, file])),
    [diff.patch],
  );

  if (rows.length === 0) {
    return (
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow="Diff"
        title="No file changes in this scope."
        detail="The Story's commits net out to no difference from the merge base."
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3" data-testid="review-diff-tab">
      <DiffControls
        rows={rows}
        layout={layout}
        showLayoutToggle={!isMobile}
        onLayoutChange={setLayout}
      />
      {/* A third column to the right of the stack is reserved for future review tools. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 shell:flex-row">
        <ReviewFileTree
          rows={rows}
          selectedPath={scrollRequest?.path}
          onSelect={(path) =>
            setScrollRequest((prev) => ({ path, nonce: (prev?.nonce ?? 0) + 1 }))
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
              source={{ storyId, tip: commits.tip, contentsCache }}
              mergeBaseRef={commits.mergeBaseRef}
              scrollRequest={scrollRequest}
              onToggleCollapsed={toggleCollapsed}
              onReviewedChange={setReviewed}
            />
          </Virtualizer>
        </div>
      </div>
    </div>
  );
}

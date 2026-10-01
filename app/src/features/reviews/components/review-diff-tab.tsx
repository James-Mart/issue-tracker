import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Virtualizer, type FileDiffMetadata } from "@pierre/diffs/react";
import type { ReviewCommits, ReviewDiff, ReviewView } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { DiffLineCounts } from "@/features/issues/components/changed-file-row";
import { DiffComposerProvider } from "@/features/issues/components/comments/diff-thread-composer";
import { DiffLayoutToggle } from "@/features/issues/components/diff-layout-toggle";
import { useDiffContentsCache } from "@/features/issues/hooks/use-diff-contents-cache";
import { useDiffLayoutPreference } from "@/features/issues/hooks/use-diff-layout-preference";
import { useVirtualizedFileScroll } from "@/features/issues/hooks/use-virtualized-file-scroll";
import type { DiffLayout } from "@/features/issues/lib/diff-layout-preference";
import { useCommentThreads } from "@/features/issues/api/queries";
import { fileDiffsFromPatch } from "@/features/issues/lib/issue-change-file-diffs";
import { useDiffScrollAnchor } from "../hooks/use-diff-scroll-anchor";
import { useReviewDiffSearch } from "../hooks/use-review-diff-search";
import { useReviewFileMarks } from "../hooks/use-review-file-marks";
import type { DiffThreadReveal } from "../hooks/use-review-workbench-location";
import {
  fileShowingThread,
  NO_FILE_THREADS,
  reviewDiffThreadsByFile,
  type ReviewFileThreads,
} from "../lib/review-diff-threads";
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
import { ReviewDiffSearch } from "./review-diff-search";
import { ReviewFileListLayout } from "./review-file-list-resize";
import { ReviewFileTree } from "./review-file-tree";
import {
  filesMatchingSearch,
  snapshotSearchableDiff,
  type DiffSearchMatch,
} from "../lib/review-diff-search";

type ScrollRequest = { path: string; nonce: number; scope: string };

/**
 * The search bar over the diff scroller, which pins the bar while the diff
 * scrolls. Desktop's bounded page gives the stack the diff pane's height. On
 * phone the page scrolls, so the stack is capped at the viewport under the
 * sticky app bar (3rem) less the page's bottom padding (2rem): scrolled to
 * the end, the bar rests at the top of the screen and the page cannot carry
 * it under the app bar.
 */
const DIFF_STACK_CLASS =
  "flex max-h-[calc(100svh-5rem)] min-h-0 min-w-0 flex-1 flex-col gap-2 shell:max-h-none";

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
  searchNeedle,
  currentMatch,
  threadsByFile,
  focusFile,
  threadReveal,
  onThreadRevealed,
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
  searchNeedle: string;
  currentMatch: DiffSearchMatch | undefined;
  threadsByFile: Map<string, ReviewFileThreads>;
  focusFile: string | undefined;
  threadReveal: DiffThreadReveal | null;
  onThreadRevealed: (reveal: DiffThreadReveal) => void;
}) {
  const fileRef = useVirtualizedFileScroll<HTMLElement>(
    scrollRequest?.path,
    scrollRequest?.nonce,
  );
  useDiffScrollAnchor();

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <ReviewFileDiff
          key={row.file.path}
          fileRef={fileRef(row.file.path)}
          row={row}
          fileDiff={fileDiffs.get(row.file.path)}
          collapsed={
            isCollapsed(row) &&
            !(currentMatch?.kind === "content" && currentMatch.path === row.file.path) &&
            row.file.path !== focusFile
          }
          threads={threadsByFile.get(row.file.path) ?? NO_FILE_THREADS}
          reveal={row.file.path === focusFile ? threadReveal ?? undefined : undefined}
          onRevealed={onThreadRevealed}
          readOnly={readOnly}
          diffLayout={diffLayout}
          source={source}
          localCommand={localFileDiffCommand(mergeBaseRef, source.sha, row.file.path, scope)}
          localHint={localHint}
          onToggleCollapsed={() => onToggleCollapsed(row)}
          onReviewedChange={(next) => onReviewedChange(row.file.path, next)}
          searchNeedle={searchNeedle}
          currentMatch={currentMatch?.path === row.file.path ? currentMatch : undefined}
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
  focusThreadId,
  threadReveal,
  onThreadRevealed,
  onFocusFileMissing,
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
  /** The open thread; its file stays expanded. */
  focusThreadId: string | null;
  threadReveal: DiffThreadReveal | null;
  onThreadRevealed: (reveal: DiffThreadReveal) => void;
  onFocusFileMissing: () => void;
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
  const contentsCache = useDiffContentsCache(commits.tip);
  const viewedSha = scope === ALL_CHANGES_SCOPE ? commits.tip : scope;

  const parsed = useMemo(() => {
    const files = fileDiffsFromPatch(diff.patch);
    return {
      fileDiffs: new Map(files.map((file) => [file.name, file])),
      searchDiffs: new Map(files.map((file) => [file.name, snapshotSearchableDiff(file)])),
    };
  }, [diff.patch]);
  const { threads } = useCommentThreads(storyId);
  const threadsByFile = useMemo(
    () => reviewDiffThreadsByFile(threads, diff.files, scope),
    [diff.files, scope, threads],
  );
  const focusAnchored = threads.some(
    (thread) => thread.root.id === focusThreadId && thread.root.anchor,
  );
  const focusFile =
    focusThreadId == null ? undefined : fileShowingThread(threadsByFile, focusThreadId);
  useEffect(() => {
    if (!focusAnchored || focusFile) return;
    if (scope === ALL_CHANGES_SCOPE) return;
    // This commit does not show the thread: it is anchored to another commit,
    // or this commit's diff lacks its file. Widen to All changes so the thread
    // can still render, matching resolveReviewScope.
    onFocusFileMissing();
  }, [focusAnchored, focusFile, onFocusFileMissing, scope]);
  const revealRequest = threadReveal?.request;
  useEffect(() => {
    if (!focusFile || revealRequest === undefined) return;
    setScrollRequest({ path: focusFile, scope, nonce: 0 });
  }, [focusFile, revealRequest, scope]);
  const search = useReviewDiffSearch(diff.files, parsed.searchDiffs, scope);
  const matchedPaths = filesMatchingSearch(search.matches);
  const visibleRows = search.filtering
    ? rows.filter((row) => matchedPaths.has(row.file.path))
    : rows;
  // A path hit sits in the file's header, so it lands with the file's top; a
  // content hit lands on its own line.
  const searchScroll =
    search.current?.kind === "path"
      ? { path: search.current.path, scope, nonce: search.scrollNonce }
      : undefined;

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
        <ReviewFileListLayout
          tree={
            <ReviewFileTree
              rows={visibleRows}
              selectedPath={search.filtering ? search.current?.path : activeScroll?.path}
              onSelect={(path) => {
                if (search.filtering) {
                  search.goToPath(path);
                  return;
                }
                setScrollRequest((prev) => ({
                  path,
                  scope,
                  nonce: (prev?.nonce ?? 0) + 1,
                }));
              }}
            />
          }
        >
          <div className={DIFF_STACK_CLASS} data-testid="review-diff-stack">
            <ReviewDiffSearch
              query={search.query}
              matchIndex={search.currentIndex}
              matchCount={search.matches.length}
              onQueryChange={search.onQueryChange}
              onPrevious={() => search.step(-1)}
              onNext={() => search.step(1)}
            />
            {visibleRows.length === 0 ? (
              <p
                className="px-1 font-mono text-[11px] text-muted-foreground"
                data-testid="review-diff-search-empty"
              >
                No matches in this diff. Clear the search or try another term.
              </p>
            ) : (
              // useDiffScrollAnchor holds the reader in place; native anchoring would fight it.
              <Virtualizer className="min-h-0 flex-1 overflow-auto [overflow-anchor:none]">
                {/* New threads anchor to the commit being viewed; the tip for All changes. */}
                <DiffComposerProvider
                  key={scope}
                  issueId={storyId}
                  commitSha={viewedSha}
                  allowQuestion
                >
                  <ReviewFileStack
                    rows={visibleRows}
                    fileDiffs={parsed.fileDiffs}
                    isCollapsed={isCollapsed}
                    readOnly={review.effectiveStatus === "archived"}
                    diffLayout={diffLayout}
                    source={{ storyId, sha: viewedSha, contentsCache }}
                    mergeBaseRef={commits.mergeBaseRef}
                    scope={scope}
                    localHint={fileTooLargeHint(scope)}
                    scrollRequest={search.filtering ? searchScroll : activeScroll}
                    onToggleCollapsed={toggleCollapsed}
                    onReviewedChange={setReviewed}
                    searchNeedle={search.needle}
                    currentMatch={search.current}
                    threadsByFile={threadsByFile}
                    focusFile={focusFile}
                    threadReveal={threadReveal}
                    onThreadRevealed={onThreadRevealed}
                  />
                </DiffComposerProvider>
              </Virtualizer>
            )}
          </div>
        </ReviewFileListLayout>
      ) : null}
    </div>
  );
}

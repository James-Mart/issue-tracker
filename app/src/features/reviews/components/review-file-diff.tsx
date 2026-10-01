import { useCallback, useEffect, useId, useRef, type MutableRefObject, type Ref } from "react";
import {
  FileDiff,
  useVirtualizer,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from "@pierre/diffs/react";
import { isLineAnchor } from "@server/schemas";
import { ChevronRight } from "lucide-react";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/cn";
import { DiffLineCounts } from "@/features/issues/components/changed-file-row";
import {
  DiffThreadComposer,
  useDiffComposer,
} from "@/features/issues/components/comments/diff-thread-composer";
import { useFileDiffContentsLoader } from "@/features/issues/hooks/use-file-diff-contents-loader";
import { useFileThreadAnnotations } from "@/features/issues/hooks/use-file-thread-annotations";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import type { DiffLayout } from "@/features/issues/lib/diff-layout-preference";
import {
  annotationSideToAnchorSide,
  newComposerOnLine,
  type AnchorSide,
} from "@/features/issues/lib/diff-thread-anchor";
import { threadNodeInPanel } from "@/features/issues/lib/issue-change-focus-thread";
import { NO_FILE_THREADS, type ReviewFileThreads } from "../lib/review-diff-threads";
import type { ReviewFileRow } from "../lib/review-files";
import type { DiffSearchMatch } from "../lib/review-diff-search";
import {
  diffLineIsPainted,
  nextDiffLineScrollTop,
  paintedDiffLineSpan,
  paintedLineForSide,
} from "../lib/review-diff-line-scroll";
import { REVIEW_SEARCH_MATCH_CSS } from "../lib/review-diff-search-mark";
import { usePinnedHeaderCollapse } from "../hooks/use-pinned-header-collapse";
import { useReviewSearchMark } from "../hooks/use-review-search-mark";
import { ChangedSinceReviewedHeaderMark } from "./changed-since-reviewed-badge";
import { MarkedPathText } from "./review-search-marked-text";
import { ReviewLineThreads, ReviewOutdatedThreads } from "./review-thread";

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

function AnnotationThreads({
  threads,
  storyId,
  file,
  lineNumber,
  side,
}: {
  threads: CommentThread[];
  storyId: string;
  file: FileDiffMetadata;
  lineNumber: number;
  side: AnchorSide;
}) {
  const { open } = useDiffComposer();
  const target = newComposerOnLine(open, file, lineNumber, side);
  return (
    <ReviewLineThreads
      threads={threads}
      storyId={storyId}
      composer={target ? <DiffThreadComposer target={target} /> : undefined}
    />
  );
}

/** Threads below the code: those without a painted line, then the Outdated group. */
function FileEndThreads({
  inline,
  outdated,
  storyId,
}: {
  inline: CommentThread[];
  outdated: CommentThread[];
  storyId: string;
}) {
  return (
    <>
      <ReviewLineThreads threads={inline} storyId={storyId} />
      <ReviewOutdatedThreads threads={outdated} storyId={storyId} />
    </>
  );
}

function RenderedFileDiff({
  fileDiff,
  diffLayout,
  source,
  threads,
}: {
  fileDiff: FileDiffMetadata;
  diffLayout: DiffLayout;
  source: ReviewFileDiffSource;
  threads: ReviewFileThreads;
}) {
  const { loading, loadDiffFiles } = useFileDiffContentsLoader({
    issueId: source.storyId,
    sha: source.sha,
    cache: source.contentsCache,
  });
  const { annotations, unlocated, openFromRange, onLineSelected } =
    useFileThreadAnnotations(fileDiff, threads.inline);
  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<CommentThread[]>) => (
      <AnnotationThreads
        threads={annotation.metadata}
        storyId={source.storyId}
        file={fileDiff}
        lineNumber={annotation.lineNumber}
        side={annotationSideToAnchorSide(annotation.side)}
      />
    ),
    [fileDiff, source.storyId],
  );

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
          enableGutterUtility: true,
          enableLineSelection: true,
          onGutterUtilityClick: openFromRange,
          onLineSelected,
        }}
        lineAnnotations={annotations}
        renderAnnotation={renderAnnotation}
      />
      <FileEndThreads inline={unlocated} outdated={threads.outdated} storyId={source.storyId} />
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
  threads = NO_FILE_THREADS,
  scrollThreadId,
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
  threads?: ReviewFileThreads;
  scrollThreadId?: string;
}) {
  const { file, reviewed, changedSinceReviewed } = row;
  const checkboxId = useId();
  const bodyId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  const virtualizer = useVirtualizer();
  useReviewSearchMark(sectionRef, currentMatch, searchNeedle, collapsed);
  const holdPinnedFile = usePinnedHeaderCollapse(sectionRef, collapsed);
  // An Outdated-group thread has no line in this diff; the reveal scrolls to its node.
  // A file anchor has no line either; the reveal scrolls to the thread node.
  const anchor = threads.inline.find((thread) => thread.root.id === scrollThreadId)?.root
    .anchor;
  const lineAnchor = anchor && isLineAnchor(anchor) ? anchor : undefined;
  useEffect(() => {
    if (!scrollThreadId || collapsed) return;
    const panel = sectionRef.current;
    if (!panel) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    let lastSpanKey = "";
    let stuck = 0;

    const reveal = () => {
      if (cancelled) return;
      attempts += 1;
      const node = threadNodeInPanel(panel, scrollThreadId);
      const host = panel.querySelector("diffs-container");
      const shadow = host instanceof HTMLElement ? host.shadowRoot : null;
      const line = lineAnchor?.line;
      const side = lineAnchor?.side;
      if (line != null && side != null && shadow != null && diffLineIsPainted(shadow, side, line)) {
        let row: HTMLElement | null = null;
        for (const candidate of shadow.querySelectorAll("[data-line]")) {
          if (paintedLineForSide(candidate, side) === line && candidate instanceof HTMLElement) {
            row = candidate;
            break;
          }
        }
        const root = virtualizer?.getRoot();
        const header = panel.querySelector('[data-testid="review-file-header"]');
        const headerHeight =
          header instanceof HTMLElement ? header.getBoundingClientRect().height : 0;
        if (row != null && root instanceof HTMLElement && virtualizer != null) {
          const delta =
            row.getBoundingClientRect().top -
            root.getBoundingClientRect().top -
            headerHeight -
            8;
          if (Math.abs(delta) > 2) {
            virtualizer.scrollTo({ top: virtualizer.getScrollTop() + delta });
          }
        } else {
          node?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
        return;
      }

      const waitingOnDiff = line != null && side != null && shadow != null;

      if (waitingOnDiff && virtualizer != null && attempts < 60) {
        const root = virtualizer.getRoot();
        const rootBox = root instanceof HTMLElement ? root.getBoundingClientRect() : null;
        const panelBox = panel.getBoundingClientRect();
        const fileInView =
          rootBox == null || (panelBox.bottom > rootBox.top && panelBox.top < rootBox.bottom);
        if (!fileInView) {
          virtualizer.scrollTo({ top: virtualizer.getOffsetInScrollContainer(panel) });
          lastSpanKey = "";
          stuck = 0;
          frame = requestAnimationFrame(reveal);
          return;
        }
        const span = paintedDiffLineSpan(shadow, side);
        if (span != null) {
          const spanKey = `${span.min}:${span.max}`;
          const next = nextDiffLineScrollTop(virtualizer.getScrollTop(), span, line);
          // Land the line inside the window, not on the overscan edge that never paints it.
          const cushion = span.height * 40;
          const direction = line > span.max ? 1 : -1;
          if (next != null && spanKey !== lastSpanKey) {
            lastSpanKey = spanKey;
            stuck = 0;
            virtualizer.scrollTo({ top: next + direction * cushion });
          } else if (next != null && stuck < 2) {
            // Pierre's overscan can leave the target just outside the painted
            // span after one jump, and the span key does not change. One more
            // nudge of the same cushion is the bound; further jumps are not.
            stuck += 1;
            virtualizer.scrollTo({
              top: virtualizer.getScrollTop() + direction * cushion,
            });
          }
        }
        frame = requestAnimationFrame(reveal);
        return;
      }

      if (node != null && node.getBoundingClientRect().height > 0) {
        node.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }
      if (attempts < 60 && (node == null || shadow != null)) {
        frame = requestAnimationFrame(reveal);
        return;
      }
      node?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    frame = requestAnimationFrame(reveal);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [collapsed, lineAnchor?.line, lineAnchor?.side, scrollThreadId, threads, virtualizer]);
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
            <>
              <FileTooLargeBody localCommand={localCommand} localHint={localHint} />
              <FileEndThreads
                inline={threads.inline}
                outdated={threads.outdated}
                storyId={source.storyId}
              />
            </>
          ) : fileDiff ? (
            <RenderedFileDiff
              fileDiff={fileDiff}
              diffLayout={diffLayout}
              source={source}
              threads={threads}
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

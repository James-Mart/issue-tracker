import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  FileDiff,
  Virtualizer,
  useVirtualizer,
  type DiffLineAnnotation,
  type FileDiffContentsLoader,
  type FileDiffMetadata,
  type SelectedLineRange,
} from "@pierre/diffs/react";
import { Link } from "react-router-dom";
import {
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError } from "@/lib/api/errors";
import type { ChangeCommit, ChangeStats, IssueChange } from "@server/schemas";
import { useCommentThreads, useIssueChangeQuery } from "../api/queries";
import { loadFileDiffContents } from "../lib/issue-change-file-contents";
import { fileDiffsFromPatch, filterFilesByPath } from "../lib/issue-change-file-diffs";
import {
  mergeComposerAnnotation,
  placeThreadsInFile,
} from "../lib/issue-change-inline-threads";
import type { CommentThread as CommentThreadData } from "../lib/comment-threads";
import {
  pathForAnchorSide,
  selectedRangeToAnchor,
} from "../lib/diff-thread-anchor";
import { CommentThread } from "./comments/comment-thread";
import {
  DiffComposerProvider,
  DiffThreadComposer,
  useDiffComposer,
} from "./comments/diff-thread-composer";
import {
  effectiveDiffLayout,
  readStoredDiffLayout,
  writeStoredDiffLayout,
  type DiffLayout,
} from "../lib/diff-layout-preference";
import { DiffLayoutToggle } from "./diff-layout-toggle";
import { IssueChangeFileNavigator } from "./issue-change-file-navigator";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function changeScopeStats(stats: ChangeStats, commitCount: number): string {
  const fileLabel = stats.filesChanged === 1 ? "1 file" : `${stats.filesChanged} files`;
  const commitLabel = commitCount === 1 ? "1 commit" : `${commitCount} commits`;
  return `${fileLabel} +${stats.insertions} -${stats.deletions} ${commitLabel}`;
}

function scopeHeaderStats(change: Extract<IssueChange, { state: "loaded" }>): string {
  const base = changeScopeStats(change.stats, change.commits.length);
  if (change.commits.length === 1) {
    return `${base} · ${shortSha(change.commits[0]!.sha)}`;
  }
  return base;
}

export type ChangeTooLargeDetails = {
  stats: ChangeStats;
  commitCount: number;
};

function isChangeStats(value: unknown): value is ChangeStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as Record<string, unknown>;
  return (
    typeof stats.filesChanged === "number" &&
    typeof stats.insertions === "number" &&
    typeof stats.deletions === "number"
  );
}

export function parseChangeTooLarge(error: unknown): ChangeTooLargeDetails | undefined {
  if (!(error instanceof ApiError) || apiErrorCode(error) !== "change-too-large") {
    return undefined;
  }
  const body = error.body;
  if (!body || typeof body !== "object") return undefined;
  const { stats, commitCount } = body as Record<string, unknown>;
  if (!isChangeStats(stats)) return undefined;
  if (typeof commitCount !== "number" || !Number.isInteger(commitCount) || commitCount < 1) {
    return undefined;
  }
  return { stats, commitCount };
}

function apiErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body;
  if (
    body &&
    typeof body === "object" &&
    "code" in body &&
    typeof (body as { code: unknown }).code === "string"
  ) {
    return (body as { code: string }).code;
  }
  return undefined;
}

export type IssueChangePanelFault =
  | "workspace-unset"
  | "commit-unreachable"
  | "commits-not-contiguous";

export function classifyIssueChangePanelFault(
  error: unknown,
): IssueChangePanelFault | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const code = apiErrorCode(error);
  if (code === "commit-unreachable") return "commit-unreachable";
  if (code === "commits-not-contiguous") return "commits-not-contiguous";
  if (code === "validation" && error.message === "Project workspace is not set") {
    return "workspace-unset";
  }
  return undefined;
}

function emptyStateCopy(reason: Extract<IssueChange, { state: "empty" }>["reason"]): {
  title: string;
  detail: string;
} {
  switch (reason) {
    case "no-commit":
      return {
        title: "No commit recorded for this task yet.",
        detail:
          "When implementation lands and records a commit sha, the combined diff will appear here.",
      };
    case "no-diff":
      return {
        title: "This task has no code change.",
        detail:
          "The tracker has no diff to load for this task. Record a commit if a change should appear here.",
      };
    case "no-descendant-commits":
      return {
        title: "No descendant tasks have recorded commits yet.",
        detail: "Rollup diffs appear when child tasks finish with commits.",
      };
  }
}

function tooLargeStateCopy(details: ChangeTooLargeDetails): {
  title: string;
  detail: ReactNode;
} {
  const { stats, commitCount } = details;
  const gitCommand =
    commitCount === 1
      ? "git show <commit-sha>"
      : "git diff <first-sha>^..<last-sha>";
  const gitHint =
    commitCount === 1
      ? "Read it in the project workspace with git show on the commit sha recorded on this task."
      : "Read it in the project workspace with git diff from the parent of the first descendant commit through the last.";

  return {
    title: "This change is too large to render in the browser.",
    detail: (
      <>
        <p className="font-mono text-xs tabular-nums">{changeScopeStats(stats, commitCount)}</p>
        <p className="mt-2">{gitHint}</p>
        <p className="mt-2 font-mono text-xs">{gitCommand}</p>
      </>
    ),
  };
}

function faultStateCopy(
  fault: IssueChangePanelFault,
  message: string,
): { title: string; detail: ReactNode } {
  switch (fault) {
    case "workspace-unset":
      return {
        title: "Project workspace is not set",
        detail: (
          <ShellFaultDetail
            message={message}
            hint="Set the project workspace to a checkout on this machine, then reload."
          />
        ),
      };
    case "commit-unreachable":
      return {
        title: "Commit not found in workspace",
        detail: (
          <ShellFaultDetail
            message={message}
            hint="Fetch the commit into the project workspace or update the recorded sha on this task."
          />
        ),
      };
    case "commits-not-contiguous":
      return {
        title: "Commits are not contiguous in history",
        detail: (
          <ShellFaultDetail
            message={message}
            hint="Child tasks recorded commits that are not adjacent in git history, so no combined diff can be shown for this issue."
          />
        ),
      };
  }
}

export function IssueChangePanel({
  issueId,
  projectId,
}: {
  issueId: string;
  projectId: string;
}) {
  const { data, isLoading, error, refetch, isFetching } = useIssueChangeQuery(issueId);

  if (isLoading) {
    return <ShellLoadingState label="Loading change…" />;
  }

  if (error) {
    const tooLarge = parseChangeTooLarge(error);
    if (tooLarge) {
      const copy = tooLargeStateCopy(tooLarge);
      return (
        <div data-testid="issue-change-too-large-state">
          <ShellState
            className="border-0 bg-transparent px-4 py-8 shadow-none"
            eyebrow="Diff"
            title={copy.title}
            detail={copy.detail}
          />
        </div>
      );
    }

    const fault = classifyIssueChangePanelFault(error);
    if (fault) {
      const copy = faultStateCopy(fault, error.message);
      return (
        <div data-testid="issue-change-fault-state" data-fault={fault}>
          <ShellState
            tone="blocked"
            className="border-0 bg-transparent px-4 py-8 shadow-none"
            eyebrow="Diff unavailable"
            title={copy.title}
            detail={copy.detail}
            action={
              fault === "workspace-unset" ? (
                <Button variant="secondary" asChild>
                  <Link to={`/projects/${encodeURIComponent(projectId)}`}>
                    Open project settings
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  Reload diff
                </Button>
              )
            }
          />
        </div>
      );
    }

    return (
      <ShellInlineFault
        message={error.message}
        hint="Reload the page or try again in a moment."
      />
    );
  }

  if (data == null) {
    return null;
  }

  if (data.state === "empty") {
    const copy = emptyStateCopy(data.reason);
    return (
      <div
        data-testid="issue-change-empty-state"
        data-empty-reason={data.reason}
      >
        <ShellState
          className="border-0 bg-transparent px-4 py-8 shadow-none"
          eyebrow="Diff"
          title={copy.title}
          detail={copy.detail}
        />
      </div>
    );
  }

  return <IssueChangeLoadedPanel change={data} issueId={issueId} />;
}

function fileComposerPaths(
  file: Pick<FileDiffMetadata, "name" | "prevName">,
): string[] {
  if (file.prevName && file.prevName !== file.name) {
    return [file.name, file.prevName];
  }
  return [file.name];
}

function FileLineThreads({
  threads,
  issueId,
  lineNumber,
  side,
  paths,
}: {
  threads: CommentThreadData[];
  issueId: string;
  lineNumber?: number;
  side?: "old" | "new";
  paths: string[];
}) {
  const composer = useDiffComposer();
  const showNew =
    lineNumber != null &&
    side != null &&
    composer.open?.kind === "new" &&
    composer.open.line === lineNumber &&
    composer.open.side === side &&
    paths.includes(composer.open.path);

  return (
    <div
      data-testid={
        lineNumber == null
          ? "issue-change-unlocated-threads"
          : "issue-change-line-threads"
      }
      data-line={lineNumber != null ? String(lineNumber) : undefined}
      data-side={side}
      className="flex flex-col gap-2 px-3 py-2"
    >
      {threads.map((thread) => {
        const replying =
          composer.open?.kind === "reply" &&
          composer.open.threadId === thread.root.id;
        return (
          <CommentThread
            key={thread.root.id}
            thread={thread}
            issueId={issueId}
            onReply={() => composer.openReply(thread.root.id)}
            replySlot={
              replying ? (
                <DiffThreadComposer
                  target={{ kind: "reply", threadId: thread.root.id }}
                />
              ) : undefined
            }
          />
        );
      })}
      {showNew && composer.open?.kind === "new" ? (
        <DiffThreadComposer target={composer.open} />
      ) : null}
    </div>
  );
}

function IssueChangeFileDiff({
  fileDiff,
  issueId,
  sha,
  contentsCache,
  diffLayout,
  threads,
  fileRef,
}: {
  fileDiff: FileDiffMetadata;
  issueId: string;
  sha: string;
  contentsCache: Map<string, Promise<string>>;
  diffLayout: DiffLayout;
  threads: CommentThreadData[];
  fileRef?: Ref<HTMLDivElement>;
}) {
  const [loading, setLoading] = useState(false);
  const loadDiffFiles: FileDiffContentsLoader = useCallback(
    async (diff) => {
      setLoading(true);
      try {
        return await loadFileDiffContents({
          issueId,
          sha,
          fileDiff: diff,
          cache: contentsCache,
        });
      } finally {
        setLoading(false);
      }
    },
    [contentsCache, issueId, sha],
  );
  const composer = useDiffComposer();
  const { located, unlocated } = useMemo(
    () => placeThreadsInFile(threads, fileDiff),
    [fileDiff, threads],
  );
  const paths = useMemo(() => fileComposerPaths(fileDiff), [fileDiff]);
  const annotations = useMemo(() => {
    const open = composer.open;
    if (open?.kind !== "new" || !paths.includes(open.path)) return located;
    return mergeComposerAnnotation(located, open);
  }, [composer.open, located, paths]);
  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<CommentThreadData[]>) => (
      <FileLineThreads
        threads={annotation.metadata}
        issueId={issueId}
        lineNumber={annotation.lineNumber}
        side={annotation.side === "deletions" ? "old" : "new"}
        paths={paths}
      />
    ),
    [issueId, paths],
  );
  const openFromRange = useCallback(
    (range: SelectedLineRange) => {
      const side = selectedRangeToAnchor(range, fileDiff.name, sha).side;
      const path = pathForAnchorSide(fileDiff, side);
      const anchor = selectedRangeToAnchor(range, path, sha);
      composer.openNew({
        kind: "new",
        path: anchor.path,
        side: anchor.side,
        line: anchor.line,
        ...(anchor.startLine !== undefined
          ? { startLine: anchor.startLine }
          : {}),
      });
    },
    [composer.openNew, fileDiff, sha],
  );
  const onLineSelected = useCallback(
    (range: SelectedLineRange | null) => {
      if (range == null || range.start === range.end) return;
      openFromRange(range);
    },
    [openFromRange],
  );

  return (
    <div
      ref={fileRef}
      className="min-w-0 overflow-hidden rounded-lg border border-border"
      data-testid="issue-change-file-diff"
      data-file-name={fileDiff.name}
      data-context-loading={loading ? "true" : undefined}
    >
      {loading ? (
        <p
          className="border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
          data-testid="issue-change-context-loading"
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
          enableGutterUtility: true,
          enableLineSelection: true,
          onGutterUtilityClick: openFromRange,
          onLineSelected,
        }}
        lineAnnotations={annotations}
        renderAnnotation={renderAnnotation}
      />
      {unlocated.length > 0 ? (
        <FileLineThreads threads={unlocated} issueId={issueId} paths={paths} />
      ) : null}
    </div>
  );
}

function IssueChangeLoadedPanel({
  change,
  issueId,
}: {
  change: Extract<IssueChange, { state: "loaded" }>;
  issueId: string;
}) {
  const files = useMemo(() => fileDiffsFromPatch(change.patch), [change.patch]);
  const { threads } = useCommentThreads(issueId);
  const contentsCache = useRef(new Map<string, Promise<string>>()).current;
  const sha = change.commits[change.commits.length - 1]!.sha;
  const isMobile = useIsMobile();
  const [layout, setLayoutState] = useState<DiffLayout>(() => readStoredDiffLayout());
  const diffLayout = effectiveDiffLayout(layout, isMobile);
  const setLayout = useCallback((next: DiffLayout) => {
    writeStoredDiffLayout(next);
    setLayoutState(next);
  }, []);
  const [filter, setFilter] = useState("");
  const [selectedName, setSelectedName] = useState<string | undefined>();
  const matched = useMemo(() => filterFilesByPath(files, filter), [files, filter]);
  const selectedFile =
    matched.find((file) => file.name === selectedName) ?? matched[0];
  const rollupFiles = files.length > 1 ? matched : files;

  return (
    <DiffComposerProvider issueId={issueId} commitSha={sha}>
      <div className="flex min-w-0 flex-col gap-3" data-testid="issue-change-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            className="font-mono text-[11px] tabular-nums text-muted-foreground"
            data-testid="issue-change-scope-header"
          >
            {scopeHeaderStats(change)}
          </p>
          {!isMobile ? (
            <DiffLayoutToggle layout={layout} onLayoutChange={setLayout} />
          ) : null}
        </div>
        <div
          className={
            files.length > 1
              ? "flex min-w-0 flex-col gap-3 shell:flex-row shell:items-start"
              : "flex min-w-0 flex-col gap-3"
          }
        >
          {files.length > 1 ? (
            <IssueChangeFileNavigator
              files={files}
              matched={matched}
              filter={filter}
              onFilterChange={setFilter}
              selectedName={selectedFile?.name ?? ""}
              onSelect={setSelectedName}
            />
          ) : null}
          {rollupFiles.length > 0 ? (
            <IssueChangeVirtualizedRollup
              files={rollupFiles}
              selectedName={selectedFile?.name}
              issueId={issueId}
              sha={sha}
              contentsCache={contentsCache}
              diffLayout={diffLayout}
              threads={threads}
            />
          ) : null}
        </div>
      </div>
    </DiffComposerProvider>
  );
}

function IssueChangeVirtualizedRollup({
  files,
  selectedName,
  issueId,
  sha,
  contentsCache,
  diffLayout,
  threads,
}: {
  files: FileDiffMetadata[];
  selectedName: string | undefined;
  issueId: string;
  sha: string;
  contentsCache: Map<string, Promise<string>>;
  diffLayout: DiffLayout;
  threads: CommentThreadData[];
}) {
  return (
    <div className="min-w-0 flex-1" data-testid="issue-change-rollup">
      <Virtualizer className="max-h-[min(70vh,56rem)] overflow-auto">
        <IssueChangeVirtualizedFiles
          files={files}
          selectedName={selectedName}
          issueId={issueId}
          sha={sha}
          contentsCache={contentsCache}
          diffLayout={diffLayout}
          threads={threads}
        />
      </Virtualizer>
    </div>
  );
}

function IssueChangeVirtualizedFiles({
  files,
  selectedName,
  issueId,
  sha,
  contentsCache,
  diffLayout,
  threads,
}: {
  files: FileDiffMetadata[];
  selectedName: string | undefined;
  issueId: string;
  sha: string;
  contentsCache: Map<string, Promise<string>>;
  diffLayout: DiffLayout;
  threads: CommentThreadData[];
}) {
  const virtualizer = useVirtualizer();
  const fileNodes = useRef(new Map<string, HTMLDivElement>());

  useLayoutEffect(() => {
    if (selectedName == null || virtualizer == null || virtualizer.getRoot() == null) {
      return;
    }
    const node = fileNodes.current.get(selectedName);
    if (node == null) return;
    virtualizer.scrollTo({
      top: virtualizer.getOffsetInScrollContainer(node),
    });
  }, [selectedName, virtualizer]);

  return (
    <div className="flex flex-col gap-3">
      {files.map((fileDiff, index) => (
        <IssueChangeFileDiff
          key={`${fileDiff.name}-${index}`}
          fileRef={(node) => {
            if (node) fileNodes.current.set(fileDiff.name, node);
            else fileNodes.current.delete(fileDiff.name);
          }}
          fileDiff={fileDiff}
          issueId={issueId}
          sha={sha}
          contentsCache={contentsCache}
          diffLayout={diffLayout}
          threads={threads}
        />
      ))}
    </div>
  );
}

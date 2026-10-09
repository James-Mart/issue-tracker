import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  FileDiff,
  Virtualizer,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from "@pierre/diffs/react";
import { Link } from "react-router-dom";
import {
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { Rail, RailNode } from "@/components/ui/rail";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import { shortSha } from "@/lib/utils/short-sha";
import type { ChangeCommit, ChangeStats, IssueChange } from "@server/schemas";
import { DetailEyebrow, SETTINGS_HEADING_CLASS } from "./detail-section";
import { useIssueChangeQuery, useReuseCommentThreads } from "../api/queries";
import { useDiffContentsCache } from "../hooks/use-diff-contents-cache";
import { useDiffLayoutPreference } from "../hooks/use-diff-layout-preference";
import { useFileDiffContentsLoader } from "../hooks/use-file-diff-contents-loader";
import { useFileThreadAnnotations } from "../hooks/use-file-thread-annotations";
import { useVirtualizedFileScroll } from "../hooks/use-virtualized-file-scroll";
import { useFocusDiffThread } from "../lib/issue-change-focus-thread";
import { fileDiffsFromPatch, filterFilesByPath } from "../lib/issue-change-file-diffs";
import type { CommentThread as CommentThreadData } from "../lib/comment-threads";
import {
  annotationSideToAnchorSide,
  newComposerOnLine,
  quoteDiffComposer,
  type AnchorSide,
} from "../lib/diff-thread-anchor";
import { quoteSource } from "../lib/quote-comment";
import { CommentThread } from "./comments/comment-thread";
import {
  ResolveThreadsProvider,
  StoryDiffThread,
  useResolveThreads,
} from "./comments/story-diff-thread";
import {
  DiffComposerProvider,
  DiffThreadComposer,
  useDiffComposer,
} from "./comments/diff-thread-composer";
import type { DiffLayout } from "../lib/diff-layout-preference";
import { DiffLayoutToggle } from "./diff-layout-toggle";
import { IssueChangeFileNavigator } from "./issue-change-file-navigator";

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
  mergeBaseRef?: string;
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
  const { stats, commitCount, mergeBaseRef } = body as Record<string, unknown>;
  if (!isChangeStats(stats)) return undefined;
  if (typeof commitCount !== "number" || !Number.isInteger(commitCount) || commitCount < 1) {
    return undefined;
  }
  return {
    stats,
    commitCount,
    ...(typeof mergeBaseRef === "string" && mergeBaseRef !== ""
      ? { mergeBaseRef }
      : {}),
  };
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
    case "no-merge-base":
      return {
        title: "Story diff waits until a merge base exists",
        detail:
          "Stacked stories inherit merge base from a parent branch. Name the parent branch or wait for it to merge before the diff can load.",
      };
  }
}

function tooLargeStateCopy(
  details: ChangeTooLargeDetails,
  mergeBase?: string,
): {
  title: string;
  detail: ReactNode;
} {
  const { stats, commitCount, mergeBaseRef } = details;
  const storyRangeRef = mergeBaseRef ?? mergeBase;
  const gitCommand = storyRangeRef
    ? `git diff ${storyRangeRef}...<last>`
    : commitCount === 1
      ? "git show <commit-sha>"
      : "git diff <first-sha>^..<last-sha>";
  const gitHint = storyRangeRef
    ? "Read it in the project workspace with git diff from the merge base through the last recorded descendant commit."
    : commitCount === 1
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
        title: "Unrecorded commits on the story line",
        detail: (
          <>
            <span className="block">
              Record the missing Task commit or remove the foreign commit from
              the story branch.
            </span>
            <span className="mt-2 block font-mono text-xs">{message}</span>
          </>
        ),
      };
  }
}

export function IssueChangePanel({
  issueId,
  projectId,
  mergeBase,
  resolveThreads = false,
}: {
  issueId: string;
  projectId: string;
  mergeBase?: string;
  /** Story detail Diff: resolve, unresolve, and inline thread chrome. */
  resolveThreads?: boolean;
}) {
  const { data, isLoading, error, refetch, isFetching } = useIssueChangeQuery(issueId);

  if (isLoading) {
    return <ShellLoadingState label="Loading change…" />;
  }

  if (error) {
    const tooLarge = parseChangeTooLarge(error);
    if (tooLarge) {
      const copy = tooLargeStateCopy(tooLarge, mergeBase);
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

  return (
    <IssueChangeLoadedPanel
      change={data}
      issueId={issueId}
      mergeBase={mergeBase}
      resolveThreads={resolveThreads}
    />
  );
}

function FileLineThreads({
  threads,
  issueId,
  line,
}: {
  threads: CommentThreadData[];
  issueId: string;
  line?: { file: FileDiffMetadata; lineNumber: number; side: AnchorSide };
}) {
  const composer = useDiffComposer();
  const resolveThreads = useResolveThreads();
  const lineNumber = line?.lineNumber;
  const newComposer = line
    ? newComposerOnLine(composer.open, line.file, line.lineNumber, line.side)
    : null;
  if (threads.length === 0 && newComposer == null) return null;

  return (
    <div
      data-testid={
        lineNumber == null
          ? "issue-change-unlocated-threads"
          : "issue-change-line-threads"
      }
      data-line={lineNumber != null ? String(lineNumber) : undefined}
      data-side={line?.side}
      className="flex flex-col gap-2 px-3 py-2"
    >
      {threads.map((thread) => {
        const replying =
          composer.open?.kind === "reply" &&
          composer.open.threadId === thread.root.id;
        const quoting =
          composer.open?.kind === "quote" &&
          composer.open.threadId === thread.root.id
            ? composer.open
            : null;
        const replySlot = replying ? (
          <DiffThreadComposer
            target={{ kind: "reply", threadId: thread.root.id }}
          />
        ) : undefined;
        const Thread = resolveThreads ? StoryDiffThread : CommentThread;
        return (
          <Thread
            key={thread.root.id}
            thread={thread}
            issueId={issueId}
            onReply={() => composer.openReply(thread.root.id)}
            replySlot={replySlot}
            onQuote={(comment) =>
              composer.openQuote(
                quoteDiffComposer(
                  quoteSource(thread.root.id, comment, thread.root.anchor),
                ),
              )
            }
            quoteSlot={quoting ? <DiffThreadComposer target={quoting} /> : undefined}
            quoteCommentId={quoting?.commentId}
          />
        );
      })}
      {newComposer ? <DiffThreadComposer target={newComposer} /> : null}
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
  const { loading, loadDiffFiles } = useFileDiffContentsLoader({
    issueId,
    sha,
    cache: contentsCache,
  });
  const { annotations, unlocated, openFromRange, onLineSelected } =
    useFileThreadAnnotations(fileDiff, threads);
  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<CommentThreadData[]>) => (
      <FileLineThreads
        threads={annotation.metadata}
        issueId={issueId}
        line={{
          file: fileDiff,
          lineNumber: annotation.lineNumber,
          side: annotationSideToAnchorSide(annotation.side),
        }}
      />
    ),
    [fileDiff, issueId],
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
        <FileLineThreads threads={unlocated} issueId={issueId} />
      ) : null}
    </div>
  );
}

function RecordedCommitsRail({ commits }: { commits: ChangeCommit[] }) {
  return (
    <div data-testid="issue-change-recorded-commits">
      <p className={SETTINGS_HEADING_CLASS}>Recorded commits</p>
      <Rail>
        {commits.map((commit, index) => (
          <RailNode
            key={commit.sha}
            state={index === commits.length - 1 ? "in-flight" : "merged"}
            edge="solid"
            glow={false}
            data-testid="issue-change-recorded-commit"
            data-sha={commit.sha}
            label={
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                  {shortSha(commit.sha)}
                </span>
                <span className="text-sm">{commit.subject}</span>
              </span>
            }
          />
        ))}
      </Rail>
    </div>
  );
}

function IssueChangeLoadedPanel({
  change,
  issueId,
  mergeBase,
  resolveThreads,
}: {
  change: Extract<IssueChange, { state: "loaded" }>;
  issueId: string;
  mergeBase?: string;
  resolveThreads: boolean;
}) {
  const files = useMemo(() => fileDiffsFromPatch(change.patch), [change.patch]);
  const { threads } = useReuseCommentThreads(issueId);
  const sha = change.commits[change.commits.length - 1]!.sha;
  const contentsCache = useDiffContentsCache(sha);
  const { layout, setLayout, diffLayout, isMobile } = useDiffLayoutPreference();
  const [filter, setFilter] = useState("");
  const [selectedName, setSelectedName] = useState<string | undefined>();
  const panelRef = useRef<HTMLDivElement>(null);
  const matched = useMemo(() => filterFilesByPath(files, filter), [files, filter]);
  const selectedFile =
    matched.find((file) => file.name === selectedName) ?? matched[0];
  const rollupFiles = files.length > 1 ? matched : files;
  useFocusDiffThread({
    files,
    threads,
    selectedName,
    setSelectedName,
    panelRef,
  });

  return (
    <ResolveThreadsProvider enabled={resolveThreads}>
    <DiffComposerProvider
      issueId={issueId}
      commitSha={sha}
      allowQuestion={resolveThreads}
    >
      <div
        ref={panelRef}
        className="flex min-w-0 flex-col gap-3"
        data-testid="issue-change-panel"
      >
        {mergeBase ? (
          <>
            <RecordedCommitsRail commits={change.commits} />
            <div
              className="flex flex-wrap items-baseline gap-x-2"
              data-testid="issue-change-merge-base"
            >
              <DetailEyebrow>Changes since</DetailEyebrow>
              <span className="font-mono text-sm">{mergeBase}</span>
            </div>
          </>
        ) : null}
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
    </ResolveThreadsProvider>
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
  const fileRef = useVirtualizedFileScroll<HTMLDivElement>(selectedName);

  return (
    <div className="flex flex-col gap-3">
      {files.map((fileDiff, index) => (
        <IssueChangeFileDiff
          key={`${fileDiff.name}-${index}`}
          fileRef={fileRef(fileDiff.name)}
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

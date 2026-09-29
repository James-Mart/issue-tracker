import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReviewCommits, ReviewView } from "@server/schemas";
import { ShellInlineFault, ShellLoadingState } from "@/app/shell-state";
import { cn } from "@/lib/utils/cn";
import { shortSha } from "@/lib/utils/short-sha";
import {
  changedFileRowClass,
  DiffLineCounts,
} from "@/features/issues/components/changed-file-row";
import { useReviewDiffQuery } from "../api/queries";
import type { ReviewMarkOverrides } from "../lib/review-scope";
import {
  allChangesReviewedCount,
  diffLineTotals,
  fileCountLabel,
} from "../lib/review-files";
import {
  ALL_CHANGES_SCOPE,
  commitReviewedCount,
} from "../lib/review-scope";
import { ReviewNoCommits } from "./review-no-commits";

function formatCommitAuthoredAt(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ScopeStats({
  files,
  additions,
  deletions,
  reviewed,
  total,
}: {
  files: number;
  additions: number;
  deletions: number;
  reviewed: number;
  total: number;
}) {
  return (
    <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
      <span>{fileCountLabel(files)}</span>{" "}
      <DiffLineCounts additions={additions} deletions={deletions} />
      <span data-testid="review-scope-progress">
        {" "}
        · {reviewed} / {total} files
      </span>
    </p>
  );
}

function ScopeRadio({
  scopeId,
  selected,
  onSelect,
  children,
}: {
  scopeId: string;
  selected: boolean;
  onSelect: (scope: string) => void;
  children: ReactNode;
}) {
  return (
    <li
      data-testid="review-scope-row"
      data-scope={scopeId}
      data-selected={selected ? "true" : "false"}
      className="flex flex-col gap-2"
    >
      <label
        className={cn(
          "flex w-full cursor-pointer items-start gap-2.5",
          changedFileRowClass(selected),
          "px-3 py-2.5 font-sans focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        )}
      >
        <input
          type="radio"
          name="review-scope"
          value={scopeId}
          checked={selected}
          data-testid="review-scope-radio"
          className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--current))] focus-visible:outline-none"
          onChange={() => onSelect(scopeId)}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</span>
      </label>
      {/* The selected row's item is where a later card expands. Nothing renders there yet. */}
    </li>
  );
}

export function ReviewCommitsPanel({
  projectId,
  review,
  commits,
  scope,
  overrides,
  onScopeChange,
}: {
  projectId: string;
  review: ReviewView;
  commits: UseQueryResult<ReviewCommits>;
  scope: string;
  overrides: ReviewMarkOverrides;
  onScopeChange: (scope: string) => void;
}) {
  const hasCommits = (commits.data?.commits.length ?? 0) > 0;
  const allDiff = useReviewDiffQuery(projectId, review.id, ALL_CHANGES_SCOPE, {
    enabled: hasCommits,
  });
  const error = commits.error ?? (hasCommits ? allDiff.error : null);

  if (error) {
    return (
      <ShellInlineFault
        message={error.message}
        hint="Check the project workspace, then reload."
      />
    );
  }
  const commitList = commits.data;
  const allFiles =
    commitList && commitList.commits.length > 0 ? allDiff.data?.files : undefined;
  if (!commitList || (commitList.commits.length > 0 && !allFiles)) {
    return <ShellLoadingState label="Loading commits…" />;
  }
  if (!allFiles) {
    return <ReviewNoCommits eyebrow="Commits" />;
  }

  const allTotals = diffLineTotals(allFiles);
  const allProgress = allChangesReviewedCount(
    review,
    allFiles,
    overrides[ALL_CHANGES_SCOPE],
  );

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      data-testid="review-commits-tab"
    >
      <div role="radiogroup" aria-label="Review scope">
        <ul className="flex flex-col gap-2">
          <ScopeRadio
            scopeId={ALL_CHANGES_SCOPE}
            selected={scope === ALL_CHANGES_SCOPE}
            onSelect={onScopeChange}
          >
            <span className="text-sm font-medium text-foreground">All changes</span>
            <ScopeStats
              files={allFiles.length}
              additions={allTotals.additions}
              deletions={allTotals.deletions}
              reviewed={allProgress.reviewed}
              total={allProgress.total}
            />
          </ScopeRadio>
          {commitList.commits.map((commit) => {
            const progress = commitReviewedCount(
              review,
              commit.sha,
              overrides[commit.sha],
            );
            return (
              <ScopeRadio
                key={commit.sha}
                scopeId={commit.sha}
                selected={scope === commit.sha}
                onSelect={onScopeChange}
              >
                <span className="text-sm text-foreground">
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {shortSha(commit.sha)}
                  </span>{" "}
                  {commit.subject}
                </span>
                <span className="text-xs text-muted-foreground">
                  {commit.author}
                  {" · "}
                  <time dateTime={commit.authoredAt}>
                    {formatCommitAuthoredAt(commit.authoredAt)}
                  </time>
                </span>
                <ScopeStats
                  files={commit.files}
                  additions={commit.additions}
                  deletions={commit.deletions}
                  reviewed={progress.reviewed}
                  total={progress.total}
                />
              </ScopeRadio>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

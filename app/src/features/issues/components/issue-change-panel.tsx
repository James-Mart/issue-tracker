import { FileDiff } from "@pierre/diffs/react";
import {
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import type { ChangeCommit, IssueChange } from "@server/schemas";
import { useIssueChangeQuery } from "../api/queries";
import { fileDiffsFromPatch } from "../lib/issue-change-file-diffs";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function commitSummary(commits: ChangeCommit[]): string {
  const count = commits.length;
  const label = count === 1 ? "1 commit" : `${count} commits`;
  if (count === 1) {
    return `${label} · ${shortSha(commits[0]!.sha)}`;
  }
  return label;
}

function scopeHeaderStats(change: Extract<IssueChange, { state: "loaded" }>): string {
  const { stats, commits } = change;
  const fileLabel = stats.filesChanged === 1 ? "1 file" : `${stats.filesChanged} files`;
  return `${fileLabel} +${stats.insertions} -${stats.deletions} ${commitSummary(commits)}`;
}

function emptyStateCopy(reason: Extract<IssueChange, { state: "empty" }>["reason"]): {
  title: string;
  detail: string;
} {
  switch (reason) {
    case "no-commit":
      return {
        title: "No commit recorded for this task yet.",
        detail: "A diff appears here after the task finishes with a commit.",
      };
    case "no-diff":
      return {
        title: "This task produced no code change.",
        detail: "Intentional no-diff tasks have nothing to render.",
      };
    case "no-descendant-commits":
      return {
        title: "No descendant tasks have recorded commits yet.",
        detail: "Rollup diffs appear when child tasks finish with commits.",
      };
  }
}

export function IssueChangePanel({ issueId }: { issueId: string }) {
  const { data, isLoading, error } = useIssueChangeQuery(issueId);

  if (isLoading) {
    return <ShellLoadingState label="Loading change…" />;
  }

  if (error) {
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
      <div data-testid="issue-change-empty-state">
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
    <div className="flex min-w-0 flex-col gap-3" data-testid="issue-change-panel">
      <p
        className="font-mono text-[11px] tabular-nums text-muted-foreground"
        data-testid="issue-change-scope-header"
      >
        {scopeHeaderStats(data)}
      </p>
      <div className="flex min-w-0 flex-col gap-3">
        {fileDiffsFromPatch(data.patch).map((fileDiff, index) => (
          <div
            key={`${fileDiff.name}-${index}`}
            className="min-w-0 overflow-hidden rounded-lg border border-border"
            data-testid="issue-change-file-diff"
            data-file-name={fileDiff.name}
          >
            <FileDiff fileDiff={fileDiff} disableWorkerPool />
          </div>
        ))}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { Link } from "react-router-dom";
import {
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
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

export type IssueChangePanelFault = "workspace-unset" | "commit-unreachable";

export function classifyIssueChangePanelFault(
  error: unknown,
): IssueChangePanelFault | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const code = apiErrorCode(error);
  if (code === "commit-unreachable") return "commit-unreachable";
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

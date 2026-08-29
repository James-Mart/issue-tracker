import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FileDiff,
  type FileDiffContentsLoader,
  type FileDiffMetadata,
} from "@pierre/diffs/react";
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
import { loadFileDiffContents } from "../lib/issue-change-file-contents";
import { fileDiffsFromPatch, filterFilesByPath } from "../lib/issue-change-file-diffs";
import { IssueChangeFileNavigator } from "./issue-change-file-navigator";

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

function IssueChangeFileDiff({
  fileDiff,
  issueId,
  sha,
  contentsCache,
}: {
  fileDiff: FileDiffMetadata;
  issueId: string;
  sha: string;
  contentsCache: Map<string, Promise<string>>;
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

  return (
    <div
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
        options={{ loadDiffFiles }}
      />
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
  const contentsCache = useRef(new Map<string, Promise<string>>()).current;
  const sha = change.commits[change.commits.length - 1]!.sha;
  const [filter, setFilter] = useState("");
  const [selectedName, setSelectedName] = useState<string | undefined>();
  const matched = useMemo(() => filterFilesByPath(files, filter), [files, filter]);
  const selectedFile =
    matched.find((file) => file.name === selectedName) ?? matched[0];

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="issue-change-panel">
      <p
        className="font-mono text-[11px] tabular-nums text-muted-foreground"
        data-testid="issue-change-scope-header"
      >
        {scopeHeaderStats(change)}
      </p>
      {files.length > 1 ? (
        <div className="flex min-w-0 flex-col gap-3 shell:flex-row shell:items-start">
          <IssueChangeFileNavigator
            files={files}
            matched={matched}
            filter={filter}
            onFilterChange={setFilter}
            selectedName={selectedFile?.name ?? ""}
            onSelect={setSelectedName}
          />
          {selectedFile ? (
            <div className="min-w-0 flex-1">
              <IssueChangeFileDiff
                key={selectedFile.name}
                fileDiff={selectedFile}
                issueId={issueId}
                sha={sha}
                contentsCache={contentsCache}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {files.map((fileDiff, index) => (
            <IssueChangeFileDiff
              key={`${fileDiff.name}-${index}`}
              fileDiff={fileDiff}
              issueId={issueId}
              sha={sha}
              contentsCache={contentsCache}
            />
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import type { IssueDetail } from "@server/schemas";
import type { PrFacts, PrUnavailable } from "@server/services/delivery";
import { githubPullRequestUrl } from "@server/services/github-pr-url";
import { issuesKeys } from "../api/keys";
import { useMergeStory } from "../api/mutations";
import { refreshProjectPullRequestsLive } from "../api/pr-sync-live";
import { useProjectPullRequestsQuery } from "../api/queries";
import { mergeControlFor } from "../lib/merge-control";
import {
  pullRequestSummary,
  type PullRequestSummary,
} from "../lib/pull-request-summary";
import { CompactMetaItem } from "./compact-meta";
import { MergePrDialog } from "./merge-pr-dialog";
import { MetaFieldActions } from "./meta-row";

/** Poll while GitHub still reports unknown mergeability and this panel is open. */
export const UNKNOWN_MERGEABLE_REFETCH_MS = 3_000;

type StoryWithPr = Extract<IssueDetail, { kind: "story" }> & {
  prUrl: string;
};

function isPrUnavailable(
  value: PrFacts | PrUnavailable,
): value is PrUnavailable {
  return "reason" in value;
}

function isUnknownMergeable(
  value: PrFacts | PrUnavailable | undefined,
): boolean {
  return (
    value !== undefined &&
    !isPrUnavailable(value) &&
    value.mergeable === "unknown"
  );
}

/** Number from a stored Story URL when cached facts have not arrived. */
function pullRequestNumberFromUrl(url: string): number | undefined {
  return githubPullRequestUrl(url)?.number;
}

function RefreshControl({
  projectId,
  busy,
}: {
  projectId: string;
  busy?: boolean;
}) {
  const qc = useQueryClient();
  const label = busy
    ? "Refreshing pull request status"
    : "Refresh pull request status";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      data-testid="pr-status-refresh"
      disabled={busy}
      onClick={() => {
        void qc.invalidateQueries({
          queryKey: issuesKeys.projectPullRequests(projectId),
        });
      }}
    >
      <RefreshCw className={busy ? "animate-spin" : undefined} />
    </Button>
  );
}

function PrNumberLink({
  url,
  number,
}: {
  url: string;
  number: number | undefined;
}) {
  const unresolved = number === undefined;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={unresolved ? url : undefined}
      className={
        unresolved
          ? "block min-w-0 max-w-full truncate font-mono text-[13px] text-primary hover:underline"
          : "font-mono text-[13px] tabular-nums text-primary hover:underline"
      }
      data-testid="pr-number-link"
    >
      {unresolved ? url : `#${number}`}
    </a>
  );
}

function PullRequestSummaryText({ summary }: { summary: PullRequestSummary }) {
  return (
    <span className="min-w-0" data-testid="pr-summary">
      <PrNumberLink url={summary.url} number={summary.number} />
      {" · "}
      <span data-testid="pr-state">{summary.state}</span>
      {" · "}
      <span data-testid="pr-review">{summary.review}</span>
      {summary.blocker ? (
        <>
          {" · "}
          <span className="text-destructive" data-testid="pr-blocker">
            {summary.blocker}
          </span>
        </>
      ) : null}
    </span>
  );
}

function MergeAction({
  storyId,
  projectId,
  facts,
}: {
  storyId: string;
  projectId: string;
  facts: PrFacts;
}) {
  const [open, setOpen] = useState(false);
  const mergeStory = useMergeStory(projectId);
  const control = mergeControlFor(facts);
  if (control.mode === "unavailable") return null;

  const auto = control.mode === "auto";
  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid={auto ? "pr-auto-merge-open" : "pr-merge-open"}
      >
        {auto ? "Enable auto-merge" : "Merge"}
      </Button>
      <MergePrDialog
        open={open}
        headRefOid={control.headRefOid}
        auto={auto}
        confirming={mergeStory.isPending}
        onOpenChange={setOpen}
        onConfirm={() => {
          mergeStory.mutate(
            {
              id: storyId,
              auto: auto || undefined,
              matchHeadCommit: control.headRefOid,
            },
            { onSuccess: () => setOpen(false) },
          );
        }}
      />
    </>
  );
}

function panelDataState(
  loading: boolean,
  summary: PullRequestSummary | undefined,
): string {
  if (loading) return "loading";
  if (!summary) return "unavailable";
  if (summary.state === "Draft") return "draft";
  if (summary.blocker) return "blocked";
  if (summary.state === "Open") return "ready";
  return summary.state.toLowerCase();
}

function PullRequestRow({
  projectId,
  busy,
  summary,
  fallbackUrl,
  merge,
}: {
  projectId: string;
  busy: boolean;
  summary: PullRequestSummary | undefined;
  fallbackUrl: string;
  merge: ReactNode;
}) {
  return (
    <CompactMetaItem
      label="Pull request"
      value={
        <MetaFieldActions>
          {summary ? (
            <PullRequestSummaryText summary={summary} />
          ) : (
            <PrNumberLink
              url={fallbackUrl}
              number={pullRequestNumberFromUrl(fallbackUrl)}
            />
          )}
          <RefreshControl projectId={projectId} busy={busy} />
          {merge}
        </MetaFieldActions>
      }
    />
  );
}

/** One fixed-panel pull request row for a Story that already has a stored `prUrl`. */
export function PrStatusPanel({
  story,
  projectId,
}: {
  story: StoryWithPr;
  projectId: string;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } =
    useProjectPullRequestsQuery(projectId);
  const entry = data?.prs[story.id];
  const facts = entry && !isPrUnavailable(entry) ? entry : undefined;
  const summary = facts
    ? pullRequestSummary(facts, story.merged)
    : undefined;
  const pollUnknown = isUnknownMergeable(entry);

  useEffect(() => {
    if (!pollUnknown) return;
    const id = window.setInterval(() => {
      void refreshProjectPullRequestsLive(qc, projectId);
    }, UNKNOWN_MERGEABLE_REFETCH_MS);
    return () => window.clearInterval(id);
  }, [pollUnknown, projectId, qc]);

  return (
    <div
      data-testid="pr-status-panel"
      data-state={panelDataState(isLoading, summary)}
    >
      <PullRequestRow
        projectId={projectId}
        busy={isLoading || isFetching}
        summary={summary}
        fallbackUrl={story.prUrl}
        merge={
          facts && summary?.merge ? (
            <MergeAction
              storyId={story.id}
              projectId={projectId}
              facts={facts}
            />
          ) : null
        }
      />
    </div>
  );
}

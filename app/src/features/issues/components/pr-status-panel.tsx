import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ShellInlineFault } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import type { IssueDetail } from "@server/schemas";
import type {
  PrFacts,
  PrUnavailable,
  ProjectPrsResponse,
} from "@server/services/delivery";
import { issuesKeys } from "../api/keys";
import { useProjectPullRequestsQuery } from "../api/queries";
import { CompactMetaItem } from "./compact-meta";
import { PrUrlDisplay } from "./readonly-git-fields";

type StoryWithPr = Extract<IssueDetail, { kind: "story" }> & {
  prUrl: string;
};

const GH_ERROR_CODES = [
  "gh-missing",
  "gh-unauthenticated",
  "gh-failed",
  "not-github-pr-url",
] as const;

type GhErrorCode = (typeof GH_ERROR_CODES)[number];

function isGhErrorCode(code: string): code is GhErrorCode {
  return (GH_ERROR_CODES as readonly string[]).includes(code);
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

function isPrUnavailable(
  value: PrFacts | PrUnavailable,
): value is PrUnavailable {
  return "reason" in value;
}

function ghErrorCopy(code: GhErrorCode, message: string): {
  title: string;
  hint: string;
} {
  switch (code) {
    case "gh-unauthenticated":
      return {
        title: message,
        hint: "Set GH_TOKEN or run gh auth login, then refresh.",
      };
    case "gh-missing":
      return {
        title: message,
        hint: "Install the GitHub CLI (gh) on PATH, then refresh.",
      };
    case "gh-failed":
      return {
        title: message,
        hint: "Check that gh works in the project workspace, then refresh.",
      };
    case "not-github-pr-url":
      return {
        title: message,
        hint: "Update the Story pull request URL to a github.com/…/pull/N link.",
      };
  }
}

function draftLabel(isDraft: boolean): string {
  return isDraft ? "Draft" : "Ready for review";
}

function mergeableLabel(mergeable: PrFacts["mergeable"]): string {
  if (mergeable === "mergeable") return "Mergeable";
  if (mergeable === "conflicting") return "Conflicting";
  return "Unknown";
}

function checksLabel(checks: PrFacts["checks"]): string {
  if (checks.state === "success") {
    return checks.total > 0 ? `Success · ${checks.total}` : "Success";
  }
  if (checks.state === "failure") {
    return checks.failing > 0
      ? `Failure · ${checks.failing} failing`
      : "Failure";
  }
  if (checks.state === "pending") {
    return checks.pending > 0
      ? `Pending · ${checks.pending}`
      : "Pending";
  }
  return "None";
}

function reviewLabel(decision: PrFacts["reviewDecision"]): string {
  if (decision === "approved") return "Approved";
  if (decision === "changes-requested") return "Changes requested";
  if (decision === "review-required") return "Review required";
  return "No review decision";
}

function draftBadgeVariant(
  isDraft: boolean,
): "warn" | "done" {
  return isDraft ? "warn" : "done";
}

function RefreshControl({
  projectId,
  busy,
}: {
  projectId: string;
  busy?: boolean;
}) {
  const qc = useQueryClient();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Refresh pull request status"
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

function PanelHeader({
  projectId,
  busy,
  trailing,
}: {
  projectId: string;
  busy?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <CompactMetaItem
      label="Pull request"
      value={
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">{trailing}</div>
          <RefreshControl projectId={projectId} busy={busy} />
        </div>
      }
    />
  );
}

function PrFactsRows({ facts }: { facts: PrFacts }) {
  return (
    <>
      <CompactMetaItem
        label="Readiness"
        value={
          <Badge variant={draftBadgeVariant(facts.isDraft)}>
            {draftLabel(facts.isDraft)}
          </Badge>
        }
      />
      <CompactMetaItem
        label="Mergeability"
        value={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{mergeableLabel(facts.mergeable)}</span>
            {facts.mergeStateStatus ? (
              <span className="font-mono text-[12px] text-muted-foreground">
                {facts.mergeStateStatus}
              </span>
            ) : null}
          </span>
        }
      />
      <CompactMetaItem label="Checks" value={checksLabel(facts.checks)} />
      <CompactMetaItem
        label="Review"
        value={reviewLabel(facts.reviewDecision)}
      />
      <CompactMetaItem
        label="Link"
        value={<PrUrlDisplay prUrl={facts.url} />}
      />
    </>
  );
}

function entryForStory(
  data: ProjectPrsResponse | undefined,
  storyId: string,
): PrFacts | PrUnavailable | undefined {
  return data?.prs[storyId];
}

/** Live PR status rows for a Story that already has a stored `prUrl`. */
export function PrStatusPanel({
  story,
  projectId,
}: {
  story: StoryWithPr;
  projectId: string;
}) {
  const { data, error, isLoading, isFetching } =
    useProjectPullRequestsQuery(projectId);

  if (isLoading) {
    return (
      <div data-testid="pr-status-panel" data-state="loading">
        <PanelHeader
          projectId={projectId}
          busy
          trailing={
            <span className="text-muted-foreground">Loading pull request…</span>
          }
        />
      </div>
    );
  }

  if (error) {
    const code = apiErrorCode(error);
    const copy =
      code && isGhErrorCode(code)
        ? ghErrorCopy(code, error.message)
        : {
            title: error.message,
            hint: "Refresh to try again.",
          };
    return (
      <div
        data-testid="pr-status-panel"
        data-state="error"
        data-error-code={code ?? "unknown"}
      >
        <PanelHeader projectId={projectId} busy={isFetching} />
        <ShellInlineFault message={copy.title} hint={copy.hint} />
      </div>
    );
  }

  const entry = entryForStory(data, story.id);
  if (!entry) {
    return (
      <div data-testid="pr-status-panel" data-state="missing">
        <PanelHeader projectId={projectId} busy={isFetching} />
        <ShellInlineFault
          message="No live pull request data for this Story."
          hint="Refresh to fetch the current GitHub state."
        />
      </div>
    );
  }

  if (isPrUnavailable(entry)) {
    return (
      <div data-testid="pr-status-panel" data-state="not-found">
        <PanelHeader
          projectId={projectId}
          busy={isFetching}
          trailing={
            <Badge variant="blocked">Unavailable</Badge>
          }
        />
        <ShellInlineFault
          message="The recorded pull request URL no longer resolves on GitHub."
          hint="Confirm the PR still exists, or update the Story pull request URL."
        />
        <CompactMetaItem
          label="Link"
          value={<PrUrlDisplay prUrl={story.prUrl} />}
        />
      </div>
    );
  }

  const blocked =
    entry.mergeable === "conflicting" ||
    entry.checks.state === "failure" ||
    entry.reviewDecision === "changes-requested" ||
    entry.mergeStateStatus.toUpperCase() === "BLOCKED";

  return (
    <div
      data-testid="pr-status-panel"
      data-state={entry.isDraft ? "draft" : blocked ? "blocked" : "ready"}
    >
      <PanelHeader
        projectId={projectId}
        busy={isFetching}
        trailing={
          <span className="font-mono text-[13px] tabular-nums">
            #{entry.number}
          </span>
        }
      />
      <PrFactsRows facts={entry} />
    </div>
  );
}

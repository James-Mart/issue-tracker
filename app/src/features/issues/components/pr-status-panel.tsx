import { useEffect, useState, type ReactNode } from "react";
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
import { useMergeStory } from "../api/mutations";
import { useProjectPullRequestsQuery } from "../api/queries";
import { mergeControlFor } from "../lib/merge-control";
import { CompactMetaItem } from "./compact-meta";
import { MergePrDialog } from "./merge-pr-dialog";
import { MetaFieldActions } from "./meta-row";

/** Poll while GitHub still reports unknown mergeability and this panel is open. */
export const UNKNOWN_MERGEABLE_REFETCH_MS = 3_000;

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

function isUnknownMergeable(
  value: PrFacts | PrUnavailable | undefined,
): boolean {
  return (
    value !== undefined &&
    !isPrUnavailable(value) &&
    value.mergeable === "unknown"
  );
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

/** Three most recent conversation comments, newest first. */
export function recentPrComments(
  comments: PrFacts["comments"],
): PrFacts["comments"] {
  return comments.slice(-3).reverse();
}

function PrCommentEntry({ comment }: { comment: PrFacts["comments"][number] }) {
  const author = comment.author ?? "Unknown";
  return (
    <li
      className="flex flex-col gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0"
      data-testid="pr-comment-entry"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
        <span className="font-medium text-foreground/80">{author}</span>
        <a
          href={comment.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
          data-testid="pr-comment-link"
        >
          comment
        </a>
      </div>
      <p className="whitespace-pre-wrap text-[13px] text-foreground">
        {comment.body}
      </p>
    </li>
  );
}

function PrCommentsSection({ facts }: { facts: PrFacts }) {
  const recent = recentPrComments(facts.comments);
  return (
    <CompactMetaItem
      label="Comments"
      value={
        <div
          className="flex flex-col gap-2"
          data-testid="pr-comments-section"
        >
          <span className="font-mono text-[13px] tabular-nums">
            {facts.commentCount}
          </span>
          {facts.commentCount === 0 ? (
            <span
              className="text-[13px] text-muted-foreground"
              data-testid="pr-comments-empty"
            >
              No conversation comments.
            </span>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {recent.map((comment) => (
                  <PrCommentEntry key={comment.url} comment={comment} />
                ))}
              </ul>
              {facts.commentCount > 3 ? (
                <a
                  href={facts.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] text-primary hover:underline"
                  data-testid="pr-comments-conversation-link"
                >
                  View all conversation comments
                </a>
              ) : null}
            </>
          )}
        </div>
      }
    />
  );
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

function PrNumberLink({ url, number }: { url: string; number: number }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[13px] tabular-nums text-primary hover:underline"
      data-testid="pr-number-link"
    >
      #{number}
    </a>
  );
}

function MergeControl({
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
  // Unknown mergeability is transient; the panel refetches instead of treating it as a gate.
  if (facts.mergeable === "unknown") return null;
  const control = mergeControlFor(facts);

  if (control.mode === "unavailable") {
    return (
      <span className="text-[13px] text-foreground" data-testid="pr-merge-unavailable">
        {control.reason}
      </span>
    );
  }

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

function PrFactsRows({
  facts,
  storyId,
  projectId,
}: {
  facts: PrFacts;
  storyId: string;
  projectId: string;
}) {
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
          <MetaFieldActions>
            <span>{mergeableLabel(facts.mergeable)}</span>
            {facts.mergeStateStatus ? (
              <span className="font-mono text-[12px] text-muted-foreground">
                {facts.mergeStateStatus}
              </span>
            ) : null}
            <MergeControl
              storyId={storyId}
              projectId={projectId}
              facts={facts}
            />
          </MetaFieldActions>
        }
      />
      <CompactMetaItem label="Checks" value={checksLabel(facts.checks)} />
      <CompactMetaItem
        label="Review"
        value={reviewLabel(facts.reviewDecision)}
      />
      <PrCommentsSection facts={facts} />
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
  const qc = useQueryClient();
  const { data, error, isLoading, isFetching } =
    useProjectPullRequestsQuery(projectId);
  const entry = entryForStory(data, story.id);
  const pollUnknown = isUnknownMergeable(entry);

  useEffect(() => {
    if (!pollUnknown) return;
    const id = window.setInterval(() => {
      void qc.invalidateQueries({
        queryKey: issuesKeys.projectPullRequests(projectId),
      });
    }, UNKNOWN_MERGEABLE_REFETCH_MS);
    return () => window.clearInterval(id);
  }, [pollUnknown, projectId, qc]);

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
        trailing={<PrNumberLink url={entry.url} number={entry.number} />}
      />
      <PrFactsRows
        facts={entry}
        storyId={story.id}
        projectId={projectId}
      />
    </div>
  );
}

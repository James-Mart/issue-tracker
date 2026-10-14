import { Loader2, Pause, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ChannelSessionListItem, IssueRecord } from "@server/schemas";
import { Button } from "@/components/ui/button";
import {
  useCancelConversationRun,
  useSendConversationMessage,
} from "@/features/agents/api/mutations";
import { implementingResumePrompt } from "@server/services/implementing-launch";
import { currentChannelSession } from "../api/channel-sessions";
import { issuesKeys } from "../api/keys";
import { useChannelSessionsQuery } from "../api/queries";
import { issuePath } from "../lib/links";
import { patchIssueImplementingLive } from "../lib/retire-channel-live-session";

type WorkRoot = Extract<IssueRecord, { kind: "epic" | "story" }>;

/** The live implementing turn, or the current open session when that flag is stale. */
export function implementingSessionToPause(
  sessions: readonly ChannelSessionListItem[] | undefined,
): ChannelSessionListItem | undefined {
  const open = (sessions ?? []).filter((session) => !session.archived);
  return open.find((session) => session.activeRun) ?? currentChannelSession(open);
}

/** Play opens the detail page when a person has to answer before the loop continues. */
export function pausedPlayOpensDetail(input: {
  needsAttention: boolean;
  awaitingHuman: boolean;
}): boolean {
  return input.needsAttention || input.awaitingHuman;
}

/** Icon-only pause for a running queue row. Cancels the live implementing turn. */
export function QueuePauseControl({ issueId }: { issueId: string }) {
  const { data: sessions, isLoading } = useChannelSessionsQuery(
    issueId,
    "implementing",
  );
  const cancel = useCancelConversationRun();
  const target = implementingSessionToPause(sessions);
  const busy = cancel.isPending;
  const disabled = busy || isLoading || target === undefined;

  return (
    <Button
      type="button"
      variant="default"
      size="icon-sm"
      title="Pause"
      aria-label="Pause"
      aria-busy={busy || undefined}
      data-testid={busy ? "flow-row-pause-pending" : "flow-row-pause"}
      disabled={disabled}
      onClick={() => {
        if (!target) return;
        cancel.mutate(target.id);
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
      ) : (
        <Pause className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

/** Icon-only resume for a paused queue row. */
export function QueueResumeControl({ issue }: { issue: WorkRoot }) {
  const qc = useQueryClient();
  const { data: sessions, isLoading } = useChannelSessionsQuery(
    issue.id,
    "implementing",
  );
  const send = useSendConversationMessage();
  const session = currentChannelSession(sessions ?? []);
  const opensDetail = pausedPlayOpensDetail({
    needsAttention: issue.needsAttention,
    awaitingHuman: session?.awaitingHuman === true,
  });
  const busy = send.isPending;

  if (opensDetail) {
    return (
      <Button asChild variant="default" size="icon-sm">
        <Link
          to={issuePath(issue.partOf, issue.id)}
          state={{ issueBackStack: [{ kind: "cockpit" }] }}
          title="Resume"
          aria-label="Resume"
          data-testid="flow-row-resume-open"
        >
          <Play className="h-3.5 w-3.5" />
        </Link>
      </Button>
    );
  }

  // No coordinator session to resume, and nothing is waiting on a person.
  if (!isLoading && session === undefined) return null;

  const disabled = busy || isLoading || session === undefined;
  const resume = () => {
    if (!session) return;
    send.mutate(
      { id: session.id, body: { prompt: implementingResumePrompt() } },
      {
        onSuccess: (result) => {
          // A pending or steered accept has no runId. The list refetch
          // carries implementingLive either way.
          if (result.runId) patchIssueImplementingLive(qc, issue.id, true);
          void qc.invalidateQueries({ queryKey: issuesKeys.list() });
        },
      },
    );
  };

  return (
    <Button
      type="button"
      variant="default"
      size="icon-sm"
      title={busy ? "Resuming" : "Resume"}
      aria-label={busy ? "Resuming" : "Resume"}
      aria-busy={busy || undefined}
      data-testid={busy ? "flow-row-resume-pending" : "flow-row-resume"}
      disabled={disabled}
      onClick={resume}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
      ) : (
        <Play className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

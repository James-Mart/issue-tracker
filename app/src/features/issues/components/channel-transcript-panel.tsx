import { useState } from "react";
import type {
  ChannelSessionListItem,
  ConversationChannel,
  IssueDetail,
} from "@server/schemas";
import {
  ShellFaultDetail,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { ConversationThread } from "@/features/agents/components/conversation-thread";
import { defaultChannelSession } from "../api/channel-sessions";
import { useChannelSessionsQuery } from "../api/queries";
import { ChannelSessionSwitcher } from "./channel-session-switcher";
import {
  PlanningChannelEmptyState,
  PlanningNewRunControl,
} from "./planning-launch-control";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;

function isPlanningIdea(
  channel: ConversationChannel,
  issue: IssueDetail | undefined,
): issue is IdeaDetail {
  return channel === "planning" && issue?.kind === "idea";
}

type StartedSession = Pick<
  ChannelSessionListItem,
  "id" | "title" | "model"
>;

/** Placeholder until the channel-sessions list refetch includes the new id. */
function pendingChannelSession(started: StartedSession): ChannelSessionListItem {
  const now = new Date().toISOString();
  return {
    id: started.id,
    title: started.title,
    model: started.model,
    createdAt: now,
    updatedAt: now,
    archived: false,
    activeRun: true,
  };
}

/**
 * Full-width channel panel: Agents transcript for the channel's current
 * session, or an empty state naming what the channel is for.
 */
export function ChannelTranscriptPanel({
  issueId,
  issue,
  channel,
  label,
}: {
  issueId: string;
  issue?: IssueDetail;
  channel: ConversationChannel;
  label: string;
}) {
  const { data, isLoading, error } = useChannelSessionsQuery(issueId, channel);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pendingStart, setPendingStart] = useState<StartedSession | undefined>();
  const planningIdea = isPlanningIdea(channel, issue) ? issue : undefined;

  if (isLoading && !data) {
    return <ShellLoadingState label={`Loading ${label.toLowerCase()} channel…`} />;
  }

  if (error) {
    return (
      <ShellState
        tone="blocked"
        eyebrow="Fault"
        title={`Could not load the ${label.toLowerCase()} channel.`}
        detail={
          <ShellFaultDetail
            message={error.message}
            hint="Check the server, then reload."
          />
        }
      />
    );
  }

  const sessions = data ?? [];
  const defaultSession = defaultChannelSession(sessions);
  const selectedFromList = selectedId
    ? sessions.find((session) => session.id === selectedId)
    : undefined;
  const pendingSession =
    pendingStart && pendingStart.id === selectedId && !selectedFromList
      ? pendingChannelSession(pendingStart)
      : undefined;
  // Keep the thread mounted after create even before list invalidation lands.
  const selectedSession =
    selectedFromList ?? pendingSession ?? defaultSession;

  const onSessionStarted = (session: StartedSession) => {
    setSelectedId(session.id);
    setPendingStart(session);
  };

  if (!selectedSession) {
    if (planningIdea) {
      return (
        <PlanningChannelEmptyState
          issue={planningIdea}
          channel={channel}
          onStarted={onSessionStarted}
        />
      );
    }

    return (
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow={label}
        title={`No ${label.toLowerCase()} session.`}
        detail={`This channel is for ${label.toLowerCase()} work on this issue.`}
      />
    );
  }

  const showSwitcher = sessions.length >= 2;
  const planningNewRun = planningIdea ? (
    <PlanningNewRunControl
      issue={planningIdea}
      channel={channel}
      onStarted={onSessionStarted}
    />
  ) : null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
      data-testid="channel-transcript-panel"
    >
      {showSwitcher ? (
        <ChannelSessionSwitcher
          issueId={issueId}
          channel={channel}
          sessions={sessions}
          selectedId={selectedSession.id}
          onSelectedIdChange={setSelectedId}
          trailing={planningNewRun}
        />
      ) : planningNewRun ? (
        <div
          className="flex min-w-0 items-center justify-end gap-2 border-b border-border px-4 py-2"
          data-testid="channel-panel-header"
        >
          {planningNewRun}
        </div>
      ) : null}
      <ConversationThread
        key={selectedSession.id}
        conversationId={selectedSession.id}
        meta={{ title: selectedSession.title, model: selectedSession.model }}
        hideComposer={selectedSession.archived}
      />
    </div>
  );
}

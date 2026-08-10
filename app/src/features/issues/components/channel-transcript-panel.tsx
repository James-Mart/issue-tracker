import { useState } from "react";
import type {
  ChannelSessionListItem,
  ConversationChannel,
  IssueDetail,
  IssueKind,
} from "@server/schemas";
import {
  ShellFaultDetail,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { ConversationThread } from "@/features/agents/components/conversation-thread";
import { defaultChannelSession } from "../api/channel-sessions";
import { useChannelSessionsQuery } from "../api/queries";
import { isImplementingWorkRoot, type ImplementingLockRefusal } from "../lib/implementing-launch";
import { ChannelSessionSwitcher } from "./channel-session-switcher";
import { ChannelRetroControl } from "./channel-retro-control";
import {
  ImplementingChannelEmptyState,
  ImplementingLockRefusalState,
  ImplementingNewRunControl,
} from "./implementing-launch-control";
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
  projectId,
  parentKind,
}: {
  issueId: string;
  issue?: IssueDetail;
  channel: ConversationChannel;
  label: string;
  projectId?: string;
  parentKind?: IssueKind;
}) {
  const { data, isLoading, error } = useChannelSessionsQuery(issueId, channel);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pendingStart, setPendingStart] = useState<StartedSession | undefined>();
  const [implementingLockRefusal, setImplementingLockRefusal] = useState<
    ImplementingLockRefusal | undefined
  >();
  const planningIdea = isPlanningIdea(channel, issue) ? issue : undefined;
  const implementingWorkRoot = isImplementingWorkRoot(channel, issue, parentKind)
    ? issue
    : undefined;

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

  if (implementingLockRefusal && projectId) {
    return (
      <ImplementingLockRefusalState
        projectId={projectId}
        refusal={implementingLockRefusal}
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
    setImplementingLockRefusal(undefined);
  };

  const onImplementingLockRefusal = (refusal: ImplementingLockRefusal) => {
    setImplementingLockRefusal(refusal);
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

    if (implementingWorkRoot && projectId) {
      return (
        <ImplementingChannelEmptyState
          issue={implementingWorkRoot}
          channel={channel}
          onStarted={onSessionStarted}
          onLockRefusal={onImplementingLockRefusal}
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
  const implementingNewRun =
    implementingWorkRoot && projectId ? (
      <ImplementingNewRunControl
        issue={implementingWorkRoot}
        channel={channel}
        onStarted={onSessionStarted}
        onLockRefusal={onImplementingLockRefusal}
      />
    ) : null;
  const channelNewRun = planningNewRun ?? implementingNewRun;
  const retroControl =
    planningIdea || implementingWorkRoot ? (
      <ChannelRetroControl
        channel={channel}
        session={selectedSession}
        issue={planningIdea ?? implementingWorkRoot!}
        parentKind={parentKind}
      />
    ) : null;
  const channelHeaderActions =
    retroControl || channelNewRun ? (
      <>
        {retroControl}
        {channelNewRun}
      </>
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
          trailing={channelHeaderActions}
        />
      ) : channelHeaderActions ? (
        <div
          className="flex min-w-0 items-center justify-end gap-2 border-b border-border px-4 py-2"
          data-testid="channel-panel-header"
        >
          {channelHeaderActions}
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

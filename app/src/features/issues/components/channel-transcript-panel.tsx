import { useState, type ReactNode } from "react";
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
import {
  ConversationThread,
  OpenThreadChrome,
} from "@/features/agents/components/conversation-thread";
import { cn } from "@/lib/utils/cn";
import { defaultChannelSession } from "../api/channel-sessions";
import { useChannelSessionsQuery } from "../api/queries";
import { isImplementingWorkRoot, type ImplementingLockRefusal } from "../lib/implementing-launch";
import { ChannelSessionOverflowMenu } from "./channel-session-overflow-menu";
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

function ChannelPanelFrame({
  mobileFullViewport,
  children,
}: {
  mobileFullViewport: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden bg-card",
        !mobileFullViewport && "rounded-lg border border-border",
      )}
      data-testid="channel-transcript-panel"
      data-mobile-full-viewport={mobileFullViewport ? "true" : undefined}
    >
      {children}
    </div>
  );
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
  mobileFullViewport = false,
  onBackToOverview,
}: {
  issueId: string;
  issue?: IssueDetail;
  channel: ConversationChannel;
  label: string;
  projectId?: string;
  parentKind?: IssueKind;
  /** Phone-width issue channel: compact chrome under TopBar. */
  mobileFullViewport?: boolean;
  onBackToOverview?: () => void;
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

  const mobileBack =
    mobileFullViewport && onBackToOverview
      ? {
          onBack: onBackToOverview,
          backAriaLabel: "Back to overview",
        }
      : undefined;

  if (isLoading && !data) {
    if (mobileFullViewport && mobileBack) {
      return (
        <ChannelPanelFrame mobileFullViewport>
          <OpenThreadChrome
            title={label}
            onBack={mobileBack.onBack}
            backAriaLabel={mobileBack.backAriaLabel}
            runActive={false}
            events={[]}
          />
          <ShellLoadingState label={`Loading ${label.toLowerCase()} channel…`} />
        </ChannelPanelFrame>
      );
    }
    return <ShellLoadingState label={`Loading ${label.toLowerCase()} channel…`} />;
  }

  if (error) {
    const fault = (
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
    if (mobileFullViewport && mobileBack) {
      return (
        <ChannelPanelFrame mobileFullViewport>
          <OpenThreadChrome
            title={label}
            onBack={mobileBack.onBack}
            backAriaLabel={mobileBack.backAriaLabel}
            runActive={false}
            events={[]}
          />
          {fault}
        </ChannelPanelFrame>
      );
    }
    return fault;
  }

  if (implementingLockRefusal && projectId) {
    const refusal = (
      <ImplementingLockRefusalState
        projectId={projectId}
        refusal={implementingLockRefusal}
      />
    );
    if (mobileFullViewport && mobileBack) {
      return (
        <ChannelPanelFrame mobileFullViewport>
          <OpenThreadChrome
            title={label}
            onBack={mobileBack.onBack}
            backAriaLabel={mobileBack.backAriaLabel}
            runActive={false}
            events={[]}
          />
          {refusal}
        </ChannelPanelFrame>
      );
    }
    return refusal;
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
    const emptyBody = planningIdea ? (
      <PlanningChannelEmptyState
        issue={planningIdea}
        channel={channel}
        onStarted={onSessionStarted}
      />
    ) : implementingWorkRoot && projectId ? (
      <ImplementingChannelEmptyState
        issue={implementingWorkRoot}
        channel={channel}
        onStarted={onSessionStarted}
        onLockRefusal={onImplementingLockRefusal}
      />
    ) : (
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow={label}
        title={`No ${label.toLowerCase()} session.`}
        detail={`This channel is for ${label.toLowerCase()} work on this issue.`}
      />
    );

    if (mobileFullViewport && mobileBack) {
      return (
        <ChannelPanelFrame mobileFullViewport>
          <OpenThreadChrome
            title={label}
            onBack={mobileBack.onBack}
            backAriaLabel={mobileBack.backAriaLabel}
            runActive={false}
            events={[]}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">{emptyBody}</div>
        </ChannelPanelFrame>
      );
    }

    return emptyBody;
  }

  const showSessionSelect = sessions.length >= 2;
  const showSessionControls = sessions.length >= 1;
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

  const overflowActions =
    showSessionControls || channelHeaderActions ? (
      <ChannelSessionOverflowMenu>
        {showSessionControls ? (
          <ChannelSessionSwitcher
            issueId={issueId}
            channel={channel}
            sessions={sessions}
            selectedId={selectedSession.id}
            onSelectedIdChange={setSelectedId}
            showSelect={showSessionSelect}
            className="border-0 px-0 py-0"
          />
        ) : null}
        {channelHeaderActions ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {channelHeaderActions}
          </div>
        ) : null}
      </ChannelSessionOverflowMenu>
    ) : null;

  const desktopHeader = showSessionControls ? (
    <ChannelSessionSwitcher
      issueId={issueId}
      channel={channel}
      sessions={sessions}
      selectedId={selectedSession.id}
      onSelectedIdChange={setSelectedId}
      showSelect={showSessionSelect}
      trailing={channelHeaderActions}
    />
  ) : channelHeaderActions ? (
    <div
      className="flex min-w-0 items-center justify-end gap-2 border-b border-border px-4 py-2"
      data-testid="channel-panel-header"
    >
      {channelHeaderActions}
    </div>
  ) : null;

  return (
    <ChannelPanelFrame mobileFullViewport={mobileFullViewport}>
      {mobileFullViewport ? null : desktopHeader}
      <ConversationThread
        key={selectedSession.id}
        conversationId={selectedSession.id}
        meta={{ title: selectedSession.title, model: selectedSession.model }}
        hideComposer={selectedSession.archived}
        onBack={mobileBack?.onBack}
        backAriaLabel={mobileBack?.backAriaLabel}
        headerActions={mobileFullViewport ? overflowActions : undefined}
      />
    </ChannelPanelFrame>
  );
}

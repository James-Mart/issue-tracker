import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ChannelSessionListItem,
  ConversationChannel,
  IssueDetail,
  IssueKind,
} from "@server/schemas";
import {
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import {
  ConversationThread,
  OpenThreadChrome,
} from "@/features/agents/components/conversation-thread";
import { cn } from "@/lib/utils/cn";
import {
  defaultChannelSession,
  outlinePlanningSessionList,
} from "../api/channel-sessions";
import { outlineChannelForRole } from "../lib/outline-session-role";
import { useChannelSessionsQuery } from "../api/queries";
import {
  cockpitLaunchOverlayForIssue,
  type CockpitLaunchFault,
} from "../lib/cockpit-launch-sync";
import {
  detailLaunchFaultCopy,
  detailLaunchPendingCopy,
  launchOverlaysChannel,
  launchTranscriptSession,
} from "../lib/detail-launch-sync";
import { useParkedRootResume } from "../hooks/use-parked-root-resume";
import { isImplementingWorkRoot } from "@server/services/implementing-launch";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { ChannelSessionOverflowMenu } from "./channel-session-overflow-menu";
import { ChannelSessionSwitcher } from "./channel-session-switcher";
import { ChannelRetroControl } from "./channel-retro-control";
import {
  ImplementingChannelEmptyState,
  ImplementingNewRunControl,
} from "./implementing-launch-control";
import {
  OUTLINE_PLANNING_EMPTY_DETAIL,
  OUTLINE_PLANNING_EMPTY_TITLE,
} from "../lib/outline-planning-launch";
import {
  PlanningChannelEmptyState,
  PlanningNewRunControl,
} from "./planning-launch-control";
import {
  PlanningConcludedBanner,
  PlanningReadOnlyBadge,
  useConcludedPlanningOutline,
} from "./planning-concluded-banner";

type IdeaDetail = Extract<IssueDetail, { kind: "idea" }>;
type OutlineDetail = Extract<IssueDetail, { kind: "outline" }>;

function isPlanningIdea(
  channel: ConversationChannel,
  issue: IssueDetail | undefined,
): issue is IdeaDetail {
  return channel === "planning" && issue?.kind === "idea";
}

function isPlanningOutline(
  channel: ConversationChannel,
  issue: IssueDetail | undefined,
): issue is OutlineDetail {
  return channel === "planning" && issue?.kind === "outline";
}

function OutlinePlanningChannelEmptyState({ label }: { label: string }) {
  return (
    <div data-testid="outline-planning-empty">
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow={label}
        title={OUTLINE_PLANNING_EMPTY_TITLE}
        detail={OUTLINE_PLANNING_EMPTY_DETAIL}
      />
    </div>
  );
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
    awaitingHuman: false,
  };
}

function ChannelLaunchFaultBanner({ fault }: { fault: CockpitLaunchFault }) {
  return (
    <div className="px-4 pt-4" data-testid="channel-launch-fault">
      <ShellInlineFault {...detailLaunchFaultCopy(fault)} />
    </div>
  );
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
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pendingStart, setPendingStart] = useState<StartedSession | undefined>();
  const pending = useCockpitLaunchStore((s) => s.pending);
  const ack = useCockpitLaunchStore((s) => s.ack);
  const fault = useCockpitLaunchStore((s) => s.fault);
  const overlay = cockpitLaunchOverlayForIssue(issueId, pending, ack);
  const launchingThis = launchOverlaysChannel(issueId, channel, overlay);
  const pendingLaunch =
    launchingThis && pending?.issueId === issueId ? pending : null;
  const planningOutline = isPlanningOutline(channel, issue) ? issue : undefined;
  const combineOutlineChannels = planningOutline !== undefined;
  const { data, isLoading, error } = useChannelSessionsQuery(issueId, channel, {
    awaitingLaunchSession: Boolean(pendingLaunch && !pendingLaunch.resumeSession),
  });
  const decompositionSessions = useChannelSessionsQuery(
    issueId,
    "decomposition",
    { enabled: combineOutlineChannels },
  );
  const listLoading =
    (isLoading && !data) ||
    (combineOutlineChannels &&
      decompositionSessions.isLoading &&
      !decompositionSessions.data);
  const listError =
    error ?? (combineOutlineChannels ? decompositionSessions.error : null);
  const parkedResume = useParkedRootResume(issueId, channel);
  const thisFault =
    fault?.issueId === issueId &&
    launchOverlaysChannel(issueId, channel, fault)
      ? fault
      : null;
  const launchFaultBanner = thisFault ? (
    <ChannelLaunchFaultBanner fault={thisFault} />
  ) : null;
  const planningIdea = isPlanningIdea(channel, issue) ? issue : undefined;
  const concludedOutline = useConcludedPlanningOutline(planningIdea);
  const concludedBanner =
    planningIdea?.archived && concludedOutline ? (
      <PlanningConcludedBanner
        outlineId={concludedOutline.id}
        outlineTitle={concludedOutline.title}
      />
    ) : null;
  const implementingWorkRoot = isImplementingWorkRoot(channel, issue, parentKind)
    ? issue
    : undefined;

  const sessions = combineOutlineChannels
    ? outlinePlanningSessionList(data ?? [], decompositionSessions.data ?? [])
    : (data ?? []);
  const launchFromList = pendingLaunch
    ? launchTranscriptSession(pendingLaunch, sessions)
    : undefined;
  // Resume keeps this id even before the sessions query returns the row.
  const launchId = launchFromList?.id ?? pendingLaunch?.resumeSession?.id;

  const sawLaunchOverlay = useRef(false);

  useEffect(() => {
    if (!launchId) return;
    setSelectedId(launchId);
  }, [launchId]);

  useEffect(() => {
    if (pending?.issueId === issueId || ack?.issueId === issueId) {
      sawLaunchOverlay.current = true;
      return;
    }
    if (!sawLaunchOverlay.current || !pendingStart) return;
    if ((data ?? []).some((session) => session.id === pendingStart.id)) {
      sawLaunchOverlay.current = false;
      return;
    }
    sawLaunchOverlay.current = false;
    setPendingStart(undefined);
    setSelectedId((id) => (id === pendingStart.id ? undefined : id));
  }, [ack?.issueId, data, issueId, pending?.issueId, pendingStart]);

  const mobileBack =
    mobileFullViewport && onBackToOverview
      ? {
          onBack: onBackToOverview,
          backAriaLabel: "Back to overview",
        }
      : undefined;

  if (listLoading) {
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

  if (listError) {
    const fault = (
      <ShellState
        tone="blocked"
        eyebrow="Fault"
        title={`Could not load the ${label.toLowerCase()} channel.`}
        detail={
          <ShellFaultDetail
            message={listError.message}
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

  // The sessions query can lag the resume click. Keep the thread on the
  // resumed id with a placeholder row until that fetch includes it.
  const resumeStandIn =
    pendingLaunch?.resumeSession && !launchFromList
      ? pendingChannelSession(pendingLaunch.resumeSession)
      : undefined;
  const defaultSession = defaultChannelSession(sessions);
  const selectedFromList = selectedId
    ? sessions.find((session) => session.id === selectedId)
    : undefined;
  const started = pendingStart ?? (launchingThis ? ack?.session : undefined);
  const pendingSession =
    started &&
    !selectedFromList &&
    (selectedId === undefined || selectedId === started.id)
      ? pendingChannelSession(started)
      : undefined;
  // The launch's session wins over an older selection. After create, keep the
  // thread mounted even before list invalidation lands.
  const selectedSession =
    launchFromList ??
    resumeStandIn ??
    selectedFromList ??
    pendingSession ??
    defaultSession;

  const onSessionStarted = (session: StartedSession) => {
    setSelectedId(session.id);
    setPendingStart(session);
  };

  if (pendingLaunch && !launchId) {
    const copy = detailLaunchPendingCopy(pendingLaunch.kind);
    const pendingBody = (
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow={label}
        title={copy.title}
        detail={copy.detail}
      />
    );
    return (
      <ChannelPanelFrame mobileFullViewport={mobileFullViewport}>
        <OpenThreadChrome
          title={label}
          onBack={mobileBack?.onBack}
          backAriaLabel={mobileBack?.backAriaLabel}
          runActive
          events={[]}
        />
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-testid="channel-launch-pending"
        >
          {pendingBody}
        </div>
      </ChannelPanelFrame>
    );
  }

  if (!selectedSession) {
    const emptyAction = planningIdea?.archived ? (
      concludedBanner ?? (
        <ShellState
          className="border-0 bg-transparent px-4 py-8 shadow-none"
          eyebrow={label}
          title="This Idea is archived."
          detail="Its planning conversation is read-only."
        />
      )
    ) : planningIdea ? (
      <PlanningChannelEmptyState
        issue={planningIdea}
        channel={channel}
        onStarted={onSessionStarted}
      />
    ) : planningOutline ? (
      <OutlinePlanningChannelEmptyState label={label} />
    ) : implementingWorkRoot && projectId ? (
      <ImplementingChannelEmptyState issue={implementingWorkRoot} />
    ) : (
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow={label}
        title={`No ${label.toLowerCase()} session.`}
        detail={`This channel is for ${label.toLowerCase()} work on this issue.`}
      />
    );
    const emptyBody = (
      <>
        {launchFaultBanner}
        {emptyAction}
      </>
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
  const channelForSession = combineOutlineChannels
    ? (session: ChannelSessionListItem) =>
        session.outlineRole !== undefined
          ? outlineChannelForRole(session.outlineRole)
          : channel
    : undefined;
  const showSessionControls = sessions.length >= 1;
  const planningNewRun =
    planningIdea && !planningIdea.archived ? (
      <PlanningNewRunControl
        issue={planningIdea}
        channel={channel}
        onStarted={onSessionStarted}
      />
    ) : null;
  const readOnlyBadge = planningIdea?.archived ? <PlanningReadOnlyBadge /> : null;
  const implementingNewRun =
    implementingWorkRoot && projectId ? (
      <ImplementingNewRunControl issue={implementingWorkRoot} />
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
            channelForSession={channelForSession}
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

  const sessionTrailing =
    readOnlyBadge || channelHeaderActions ? (
      <>
        {channelHeaderActions}
        {readOnlyBadge}
      </>
    ) : null;
  const desktopHeader = showSessionControls ? (
    <ChannelSessionSwitcher
      issueId={issueId}
      channel={channel}
      sessions={sessions}
      selectedId={selectedSession.id}
      onSelectedIdChange={setSelectedId}
      showSelect={showSessionSelect}
      channelForSession={channelForSession}
      trailing={sessionTrailing}
    />
  ) : sessionTrailing ? (
    <div
      className="flex min-w-0 items-center justify-end gap-2 border-b border-border px-4 py-2"
      data-testid="channel-panel-header"
    >
      {sessionTrailing}
    </div>
  ) : null;

  return (
    <ChannelPanelFrame mobileFullViewport={mobileFullViewport}>
      {mobileFullViewport ? null : desktopHeader}
      <ConversationThread
        key={selectedSession.id}
        conversationId={selectedSession.id}
        meta={{ title: selectedSession.title, model: selectedSession.model }}
        hideComposer={
          selectedSession.archived || Boolean(planningIdea?.archived)
        }
        pauseCancel={channel === "implementing"}
        parkedResume={parkedResume}
        onBack={mobileBack?.onBack}
        backAriaLabel={mobileBack?.backAriaLabel}
        headerActions={
          mobileFullViewport && (readOnlyBadge || overflowActions) ? (
            <>
              {readOnlyBadge}
              {overflowActions}
            </>
          ) : undefined
        }
        banner={
          launchFaultBanner || concludedBanner ? (
            <>
              {launchFaultBanner}
              {concludedBanner}
            </>
          ) : undefined
        }
      />
    </ChannelPanelFrame>
  );
}

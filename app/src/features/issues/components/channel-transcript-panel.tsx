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
  currentChannelSession,
  defaultChannelSession,
} from "../api/channel-sessions";
import { useAttachmentsQuery, useChannelSessionsQuery } from "../api/queries";
import { cockpitLaunchOverlayForIssue } from "../lib/cockpit-launch-sync";
import {
  detailLaunchFaultCopy,
  detailLaunchPendingCopy,
  launchOverlaysChannel,
} from "../lib/detail-launch-sync";
import { exportDraftCount } from "../lib/export-tab";
import { isImplementingWorkRoot } from "../lib/implementing-launch";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { ChannelSessionOverflowMenu } from "./channel-session-overflow-menu";
import { ChannelSessionSwitcher } from "./channel-session-switcher";
import { ChannelRetroControl } from "./channel-retro-control";
import { useExportTranscriptChrome } from "./export-transcript-chrome";
import { ExportReviewWorkbench } from "./export-review-workbench";
import {
  ImplementingChannelEmptyState,
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
    awaitingHuman: false,
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
function ChannelTranscriptBody({
  issueId,
  issue,
  channel,
  label,
  projectId,
  parentKind,
  mobileFullViewport = false,
  onBackToOverview,
  composerDisabled = false,
  composerDisabledPlaceholder,
  extraHeaderActions,
  preferredSessionId,
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
  composerDisabled?: boolean;
  composerDisabledPlaceholder?: string;
  extraHeaderActions?: ReactNode;
  preferredSessionId?: string;
}) {
  const { data, isLoading, error } = useChannelSessionsQuery(issueId, channel);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [pendingStart, setPendingStart] = useState<StartedSession | undefined>();
  const pending = useCockpitLaunchStore((s) => s.pending);
  const ack = useCockpitLaunchStore((s) => s.ack);
  const fault = useCockpitLaunchStore((s) => s.fault);
  const overlay = cockpitLaunchOverlayForIssue(issueId, pending, ack);
  const launchingThis = launchOverlaysChannel(issueId, channel, overlay);
  const pendingLaunch = launchingThis && pending?.issueId === issueId ? pending : null;
  const thisFault =
    fault?.issueId === issueId &&
    launchOverlaysChannel(issueId, channel, fault)
      ? fault
      : null;
  const planningIdea = isPlanningIdea(channel, issue) ? issue : undefined;
  const implementingWorkRoot = isImplementingWorkRoot(channel, issue, parentKind)
    ? issue
    : undefined;

  const sawLaunchOverlay = useRef(false);
  useEffect(() => {
    if (!preferredSessionId) return;
    setSelectedId(preferredSessionId);
  }, [preferredSessionId]);

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

  const sessions = data ?? [];
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
  // Keep the thread mounted after create even before list invalidation lands.
  const selectedSession =
    selectedFromList ?? pendingSession ?? defaultSession;

  const onSessionStarted = (session: StartedSession) => {
    setSelectedId(session.id);
    setPendingStart(session);
  };

  if (pendingLaunch) {
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
    const emptyAction = planningIdea ? (
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
      />
    ) : (
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow={label}
        title={`No ${label.toLowerCase()} session.`}
        detail={`This channel is for ${label.toLowerCase()} work on this issue.`}
      />
    );
    const faultBanner = thisFault ? (
      <div className="px-4 pt-4" data-testid="channel-launch-fault">
        <ShellInlineFault {...detailLaunchFaultCopy(thisFault)} />
      </div>
    ) : null;
    const emptyBody = (
      <>
        {faultBanner}
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
    retroControl || channelNewRun || extraHeaderActions ? (
      <>
        {retroControl}
        {channelNewRun}
        {extraHeaderActions}
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
        composerDisabled={composerDisabled}
        composerDisabledPlaceholder={composerDisabledPlaceholder}
        onBack={mobileBack?.onBack}
        backAriaLabel={mobileBack?.backAriaLabel}
        headerActions={mobileFullViewport ? overflowActions : undefined}
      />
    </ChannelPanelFrame>
  );
}

/** Export tab: composer lock and Retry follow the current export session. */
function ExportChannelTranscript(props: {
  issueId: string;
  issue?: IssueDetail;
  channel: ConversationChannel;
  label: string;
  projectId?: string;
  parentKind?: IssueKind;
  mobileFullViewport?: boolean;
  onBackToOverview?: () => void;
  onExportDraftReaderOpenChange?: (open: boolean) => void;
}) {
  const [retriedId, setRetriedId] = useState<string | undefined>();
  const { data } = useChannelSessionsQuery(props.issueId, "export");
  const attachments = useAttachmentsQuery(props.issueId);
  const current = currentChannelSession(data ?? []);
  const chrome = useExportTranscriptChrome(
    { id: props.issueId, title: props.issue?.title ?? "" },
    current,
    ({ id }) => setRetriedId(id),
  );
  const transcript = (
    <ChannelTranscriptBody
      {...props}
      composerDisabled={chrome.composerDisabled}
      composerDisabledPlaceholder={chrome.composerDisabledPlaceholder}
      extraHeaderActions={chrome.retry}
      preferredSessionId={retriedId}
    />
  );
  const draftCount = exportDraftCount(
    (attachments.data ?? []).map((item) => item.name),
  );
  if (attachments.isLoading && attachments.data === undefined) {
    return <ShellLoadingState label="Loading export…" />;
  }
  if (draftCount > 0 && props.issue) {
    return (
      <ExportReviewWorkbench
        issue={props.issue}
        session={current}
        transcript={transcript}
        onExportDraftReaderOpenChange={props.onExportDraftReaderOpenChange}
      />
    );
  }
  return transcript;
}

/** Full-width channel panel. Export adds rewrite chrome around the transcript. */
export function ChannelTranscriptPanel(props: {
  issueId: string;
  issue?: IssueDetail;
  channel: ConversationChannel;
  label: string;
  projectId?: string;
  parentKind?: IssueKind;
  mobileFullViewport?: boolean;
  onBackToOverview?: () => void;
  onExportDraftReaderOpenChange?: (open: boolean) => void;
}) {
  if (props.channel === "export") return <ExportChannelTranscript {...props} />;
  return <ChannelTranscriptBody {...props} />;
}

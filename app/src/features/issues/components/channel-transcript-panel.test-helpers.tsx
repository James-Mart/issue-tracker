import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, vi } from "vitest";
import type { ChannelSessionListItem, IssueDetail } from "@server/schemas";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { ChannelTranscriptPanel } from "./channel-transcript-panel";

const fixtures = vi.hoisted(() => ({
  queryState: {
    data: undefined as ChannelSessionListItem[] | undefined,
    isLoading: false,
    error: null as Error | null,
  },
  queryArgs: {
    awaitingLaunchSession: undefined as boolean | undefined,
  },
  attachmentState: {
    data: [] as { name: string }[],
    isLoading: false,
  },
  threadProps: {
    hideComposer: false,
    onBack: undefined as (() => void) | undefined,
    headerActions: false,
  },
  deleteMutate: vi.fn(),
}));

export const queryState = fixtures.queryState;
export const queryArgs = fixtures.queryArgs;
export const attachmentState = fixtures.attachmentState;
export const threadProps = fixtures.threadProps;
export const deleteMutate = fixtures.deleteMutate;

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: (
    _issueId: string,
    _channel: string,
    options?: { awaitingLaunchSession?: boolean },
  ) => {
    fixtures.queryArgs.awaitingLaunchSession = options?.awaitingLaunchSession;
    return {
      data: fixtures.queryState.data,
      isLoading: fixtures.queryState.isLoading,
      error: fixtures.queryState.error,
    };
  },
  useAttachmentsQuery: () => ({
    data: fixtures.attachmentState.data,
    isLoading: fixtures.attachmentState.isLoading,
    isError: false,
    error: null,
  }),
}));

vi.mock("./export-review-workbench", () => ({
  ExportReviewWorkbench: () => <div data-testid="export-review-workbench" />,
}));

vi.mock("./planning-launch-control", () => ({
  PlanningChannelEmptyState: ({
    onStarted,
  }: {
    onStarted: (session: {
      id: string;
      title: string;
      model: string;
    }) => void;
  }) => (
    <div data-testid="planning-channel-empty-state">
      <button
        type="button"
        onClick={() =>
          onStarted({
            id: "new-session",
            title: "Plan Capture",
            model: "composer-2.5",
          })
        }
      >
        Start planning
      </button>
    </div>
  ),
  PlanningNewRunControl: () => (
    <button type="button" data-testid="planning-new-run">
      New run
    </button>
  ),
}));

vi.mock("./implementing-launch-control", () => ({
  ImplementingChannelEmptyState: ({
    onStarted,
  }: {
    onStarted: (session: {
      id: string;
      title: string;
      model: string;
    }) => void;
  }) => (
    <div data-testid="implementing-channel-empty-state">
      <button
        type="button"
        data-testid="implementing-start-session"
        onClick={() =>
          onStarted({
            id: "impl-session",
            title: "Implement Ship it",
            model: "composer-2.5",
          })
        }
      >
        Start work loop
      </button>
    </div>
  ),
  ImplementingNewRunControl: () => (
    <button type="button" data-testid="implementing-new-run">
      New run
    </button>
  ),
}));

vi.mock("./export-transcript-chrome", () => ({
  useExportTranscriptChrome: () => ({
    composerDisabled: true,
    composerDisabledPlaceholder: "Message disabled while rewrite runs...",
    retry: null,
  }),
}));

vi.mock("./channel-retro-control", () => ({
  ChannelRetroControl: () => (
    <button type="button" data-testid="channel-retro">
      Retro
    </button>
  ),
}));

vi.mock("./channel-session-switcher", () => ({
  ChannelSessionSwitcher: ({
    sessions,
    selectedId,
    onSelectedIdChange,
    showSelect = true,
    trailing,
  }: {
    sessions: readonly ChannelSessionListItem[];
    selectedId: string;
    onSelectedIdChange: (id: string) => void;
    showSelect?: boolean;
    trailing?: ReactNode;
  }) => (
    <div data-testid="channel-session-switcher">
      {showSelect
        ? sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              data-testid={`pick-session-${session.id}`}
              aria-pressed={session.id === selectedId}
              onClick={() => onSelectedIdChange(session.id)}
            >
              {session.id}
            </button>
          ))
        : null}
      <button
        type="button"
        data-testid="channel-session-delete"
        onClick={() =>
          fixtures.deleteMutate(selectedId, {
            onSuccess: () => {
              const remaining = sessions.filter(
                (session) => session.id !== selectedId,
              );
              const next = remaining[0];
              if (next) onSelectedIdChange(next.id);
            },
          })
        }
      >
        Delete session
      </button>
      {trailing}
    </div>
  ),
}));

vi.mock("./channel-session-overflow-menu", () => ({
  ChannelSessionOverflowMenu: ({
    children,
  }: {
    children: ReactNode;
  }) => (
    <div data-testid="channel-session-overflow-menu">
      <div data-testid="channel-session-overflow-content">{children}</div>
    </div>
  ),
}));

vi.mock("@/features/agents/components/conversation-thread", () => ({
  OpenThreadChrome: ({
    title,
    onBack,
    actions,
  }: {
    title: string;
    onBack?: () => void;
    actions?: ReactNode;
  }) => (
    <div data-testid="open-thread-chrome" data-title={title}>
      {onBack ? (
        <button type="button" aria-label="Back to overview" onClick={onBack}>
          Back
        </button>
      ) : null}
      <span data-testid="thread-status-strip">idle</span>
      {actions}
    </div>
  ),
  ConversationThread: ({
    conversationId,
    meta,
    hideComposer,
    composerDisabled,
    onBack,
    headerActions,
    banner,
  }: {
    conversationId: string;
    meta?: { title: string; model: string };
    hideComposer?: boolean;
    composerDisabled?: boolean;
    onBack?: () => void;
    headerActions?: ReactNode;
    banner?: ReactNode;
  }) => {
    fixtures.threadProps.hideComposer = hideComposer ?? false;
    fixtures.threadProps.onBack = onBack;
    fixtures.threadProps.headerActions = Boolean(headerActions);
    return (
      <div
        data-testid="conversation-thread"
        data-conversation-id={conversationId}
        data-model={meta?.model ?? ""}
        data-hide-composer={hideComposer ? "true" : "false"}
        data-composer-disabled={composerDisabled ? "true" : "false"}
      >
        {onBack ? (
          <button type="button" aria-label="Back to overview" onClick={onBack}>
            Back
          </button>
        ) : null}
        <span data-testid="thread-status-strip">idle</span>
        {headerActions}
        {banner}
      </div>
    );
  },
}));

export function mountPanel(
  label = "Planning",
  issue?: IssueDetail,
  options?: {
    channel?: "planning" | "implementing" | "export";
    projectId?: string;
    parentKind?: "project" | "epic";
    mobileFullViewport?: boolean;
    onBackToOverview?: () => void;
  },
): {
  container: HTMLDivElement;
  root: Root;
  rerender: () => void;
} {
  const channel = options?.channel ?? "planning";
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = () => {
    act(() => {
      root.render(
        <ChannelTranscriptPanel
          issueId={issue?.id ?? "capture"}
          issue={issue}
          channel={channel}
          label={label}
          projectId={options?.projectId}
          parentKind={options?.parentKind}
          mobileFullViewport={options?.mobileFullViewport}
          onBackToOverview={options?.onBackToOverview}
        />,
      );
    });
  };
  rerender();
  return { container, root, rerender };
}


export const idea: IssueDetail = {
  kind: "idea",
  id: "capture",
  title: "Capture",
  partOf: "platform",
  order: 0,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  description: "",
  version: "1",
};

export const epic: IssueDetail = {
  kind: "epic",
  id: "ship-it",
  title: "Ship it",
  partOf: "platform",
  blockedBy: [],
  needsAttention: false,
  attentionReason: null,
  order: 0,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  description: "",
  version: "1",
};

afterEach(() => {
  document.body.innerHTML = "";
  queryState.data = undefined;
  queryState.isLoading = false;
  queryState.error = null;
  queryArgs.awaitingLaunchSession = undefined;
  attachmentState.data = [];
  attachmentState.isLoading = false;
  threadProps.hideComposer = false;
  threadProps.onBack = undefined;
  threadProps.headerActions = false;
  deleteMutate.mockReset();
  resetCockpitLaunchStore();
});


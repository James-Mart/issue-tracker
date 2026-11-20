import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, vi } from "vitest";
import type {
  ChannelSessionListItem,
  ConversationChannel,
  DerivedState,
  IssueDetail,
  IssueRecord,
} from "@server/schemas";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { ChannelTranscriptPanel } from "./channel-transcript-panel";

const fixtures = vi.hoisted(() => ({
  queryState: {
    data: undefined as ChannelSessionListItem[] | undefined,
    byChannel: {} as Partial<
      Record<ConversationChannel, ChannelSessionListItem[] | undefined>
    >,
  },
  queryArgs: {
    awaitingLaunchSession: undefined as boolean | undefined,
  },
  issuesState: {
    data: undefined as
      | { issues: IssueRecord[]; derived: Record<string, DerivedState> }
      | undefined,
  },
}));

export const queryState = fixtures.queryState;
export const queryArgs = fixtures.queryArgs;
export const issuesState = fixtures.issuesState;

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: (
    _issueId: string,
    channel: ConversationChannel,
    options?: { awaitingLaunchSession?: boolean; enabled?: boolean },
  ) => {
    if (options && "awaitingLaunchSession" in options) {
      fixtures.queryArgs.awaitingLaunchSession = options.awaitingLaunchSession;
    }
    if (options?.enabled === false) {
      return { data: undefined, isLoading: false, error: null };
    }
    const byChannel = fixtures.queryState.byChannel[channel];
    return {
      data: byChannel ?? fixtures.queryState.data,
      isLoading: false,
      error: null,
    };
  },
  useAttachmentsQuery: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useIssuesQuery: () => ({
    data: fixtures.issuesState.data,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../hooks/use-parked-root-resume", () => ({
  useParkedRootResume: () => undefined,
}));

vi.mock("./planning-launch-control", () => ({
  PlanningChannelEmptyState: () => (
    <div data-testid="planning-channel-empty-state" />
  ),
  PlanningNewRunControl: () => <div data-testid="planning-new-run" />,
}));

vi.mock("./outline-new-planning-session", () => ({
  OutlineNewPlanningSessionControl: ({
    disabled,
  }: {
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="outline-new-planning-session"
      disabled={disabled}
    >
      New planning session
    </button>
  ),
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
      {trailing}
    </div>
  ),
}));

vi.mock("@/features/agents/components/conversation-thread", () => ({
  OpenThreadChrome: ({ actions }: { actions?: ReactNode }) => (
    <div data-testid="open-thread-chrome">{actions}</div>
  ),
  ConversationThread: ({
    conversationId,
    hideComposer,
    headerActions,
    banner,
    composerNote,
    composerDisabled,
  }: {
    conversationId: string;
    hideComposer?: boolean;
    headerActions?: ReactNode;
    banner?: ReactNode;
    composerNote?: ReactNode;
    composerDisabled?: boolean;
  }) => (
    <div
      data-testid="conversation-thread"
      data-conversation-id={conversationId}
      data-hide-composer={hideComposer ? "true" : "false"}
      data-composer-disabled={composerDisabled ? "true" : "false"}
    >
      {headerActions}
      {banner}
      {composerNote}
    </div>
  ),
}));

export function mountPanel(
  issue?: IssueDetail,
  options?: {
    channel?: ConversationChannel;
    label?: string;
    projectId?: string;
  },
): {
  container: HTMLDivElement;
  root: Root;
  rerender: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rerender = () => {
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ChannelTranscriptPanel
              issueId={issue?.id ?? "capture"}
              issue={issue}
              channel={options?.channel ?? "planning"}
              label={options?.label ?? "Planning"}
              projectId={options?.projectId}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  };
  rerender();
  return { container, root, rerender };
}

export const idea: Extract<IssueDetail, { kind: "idea" }> = {
  kind: "idea",
  id: "capture",
  title: "Capture",
  partOf: "platform",
  order: 0,
  archived: false,
  decompositionGate: false,
  executionGate: "auto",
  outOfBand: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  description: "",
  version: "1",
};

afterEach(() => {
  document.body.innerHTML = "";
  queryState.data = undefined;
  queryState.byChannel = {};
  queryArgs.awaitingLaunchSession = undefined;
  issuesState.data = undefined;
  resetCockpitLaunchStore();
});


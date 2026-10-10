import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, vi } from "vitest";
import type { ChannelSessionListItem, IssueDetail } from "@server/schemas";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { ChannelTranscriptPanel } from "./channel-transcript-panel";

const fixtures = vi.hoisted(() => ({
  queryState: {
    data: undefined as ChannelSessionListItem[] | undefined,
  },
  queryArgs: {
    awaitingLaunchSession: undefined as boolean | undefined,
  },
}));

export const queryState = fixtures.queryState;
export const queryArgs = fixtures.queryArgs;

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: (
    _issueId: string,
    _channel: string,
    options?: { awaitingLaunchSession?: boolean },
  ) => {
    fixtures.queryArgs.awaitingLaunchSession = options?.awaitingLaunchSession;
    return {
      data: fixtures.queryState.data,
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
}));

vi.mock("./planning-launch-control", () => ({
  PlanningChannelEmptyState: () => (
    <div data-testid="planning-channel-empty-state" />
  ),
  PlanningNewRunControl: () => null,
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
  }: {
    conversationId: string;
    hideComposer?: boolean;
    headerActions?: ReactNode;
    banner?: ReactNode;
  }) => (
    <div
      data-testid="conversation-thread"
      data-conversation-id={conversationId}
      data-hide-composer={hideComposer ? "true" : "false"}
    >
      {headerActions}
      {banner}
    </div>
  ),
}));

export function mountPanel(issue?: IssueDetail): {
  container: HTMLDivElement;
  root: Root;
  rerender: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = () => {
    act(() => {
      root.render(
        <ChannelTranscriptPanel
          issueId={issue?.id ?? "capture"}
          issue={issue}
          channel="planning"
          label="Planning"
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

afterEach(() => {
  document.body.innerHTML = "";
  queryState.data = undefined;
  queryArgs.awaitingLaunchSession = undefined;
  resetCockpitLaunchStore();
});


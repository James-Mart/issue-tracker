// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import {
  resetCockpitLaunchStore,
  useCockpitLaunchStore,
} from "../store/use-cockpit-launch-store";
import { useChannelTabIndicator } from "./use-channel-tab-indicator";
import { channelSessionListItem } from "../test/channel-session-list-item";

const sessionsState = vi.hoisted(() => ({
  data: [] as ChannelSessionListItem[],
}));

const conversationEvents = vi.hoisted(() => vi.fn());
const conversationRunActive = vi.hoisted(() => vi.fn());

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: () => ({
    data: sessionsState.data,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/features/agents/hooks/use-conversation-events", () => ({
  useConversationEvents: (...args: unknown[]) => conversationEvents(...args),
}));

vi.mock("@/features/agents/hooks/use-conversation-run-active", () => ({
  useConversationRunActive: (...args: unknown[]) => conversationRunActive(...args),
}));

function Probe({
  onReady,
}: {
  onReady: (indicator: ReturnType<typeof useChannelTabIndicator>) => void;
}) {
  const indicator = useChannelTabIndicator("capture", "planning");
  onReady(indicator);
  return <span data-testid="indicator">{indicator ?? "none"}</span>;
}

function mountProbe(): {
  root: Root;
  getIndicator: () => ReturnType<typeof useChannelTabIndicator>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let indicator!: ReturnType<typeof useChannelTabIndicator>;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe
          onReady={(next) => {
            indicator = next;
          }}
        />
      </QueryClientProvider>,
    );
  });
  return { root, getIndicator: () => indicator };
}

afterEach(() => {
  document.body.innerHTML = "";
  sessionsState.data = [];
  conversationEvents.mockClear();
  conversationRunActive.mockClear();
  resetCockpitLaunchStore();
});

describe("useChannelTabIndicator", () => {
  it("returns null when the channel has no live session", () => {
    sessionsState.data = [];
    const { getIndicator } = mountProbe();
    expect(getIndicator()).toBeNull();
    expect(conversationEvents).not.toHaveBeenCalled();
    expect(conversationRunActive).not.toHaveBeenCalled();
  });

  it("shows active-run from the session list for a hidden channel tab", () => {
    sessionsState.data = [
      channelSessionListItem({
        id: "live",
        activeRun: true,
        awaitingHuman: false,
      }),
    ];
    const { getIndicator } = mountProbe();
    expect(getIndicator()).toBe("active-run");
    expect(conversationEvents).not.toHaveBeenCalled();
    expect(conversationRunActive).not.toHaveBeenCalled();
  });

  it("shows awaiting-human from the session list when idle", () => {
    sessionsState.data = [
      channelSessionListItem({
        id: "waiting",
        activeRun: false,
        awaitingHuman: true,
      }),
    ];
    const { getIndicator } = mountProbe();
    expect(getIndicator()).toBe("awaiting-human");
    expect(conversationEvents).not.toHaveBeenCalled();
    expect(conversationRunActive).not.toHaveBeenCalled();
  });

  it("prefers active-run over awaiting-human from list fields", () => {
    sessionsState.data = [
      channelSessionListItem({
        id: "both",
        activeRun: true,
        awaitingHuman: true,
      }),
    ];
    const { getIndicator } = mountProbe();
    expect(getIndicator()).toBe("active-run");
  });

  it("shows active-run from an optimistic launch before a session exists", () => {
    sessionsState.data = [];
    useCockpitLaunchStore.getState().beginLaunch("capture", "planning");
    const { getIndicator } = mountProbe();
    expect(getIndicator()).toBe("active-run");
  });

  it("ignores archived sessions when picking the current session", () => {
    sessionsState.data = [
      channelSessionListItem({
        id: "archived",
        archived: true,
        activeRun: true,
        awaitingHuman: true,
      }),
    ];
    const { getIndicator } = mountProbe();
    expect(getIndicator()).toBeNull();
  });
});

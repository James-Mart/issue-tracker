// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import { ChannelTranscriptPanel } from "./channel-transcript-panel";

const queryState = vi.hoisted(() => ({
  data: undefined as ChannelSessionListItem[] | undefined,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: () => ({
    data: queryState.data,
    isLoading: queryState.isLoading,
    error: queryState.error,
  }),
}));

vi.mock("@/features/agents/components/conversation-thread", () => ({
  ConversationThread: ({
    conversationId,
    meta,
  }: {
    conversationId: string;
    meta?: { title: string; model: string };
  }) => (
    <div
      data-testid="conversation-thread"
      data-conversation-id={conversationId}
      data-model={meta?.model ?? ""}
    />
  ),
}));

function mountPanel(label = "Planning"): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChannelTranscriptPanel
        issueId="capture"
        channel="planning"
        label={label}
      />,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  queryState.data = undefined;
  queryState.isLoading = false;
  queryState.error = null;
});

describe("ChannelTranscriptPanel", () => {
  it("shows ShellState and no composer when the channel has no session", () => {
    queryState.data = [];
    const { container } = mountPanel();
    expect(container.textContent).toContain("No planning session.");
    expect(container.textContent).toContain(
      "This channel is for planning work on this issue.",
    );
    expect(
      container.querySelector('[data-testid="conversation-composer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
  });

  it("hosts ConversationThread for the most recent non-archived session", () => {
    queryState.data = [
      {
        id: "archived-newer",
        title: "Old",
        model: "composer-2.5-fast",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        archived: true,
        activeRun: false,
      },
      {
        id: "live",
        title: "Live plan",
        model: "composer-2.5-fast",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: false,
      },
    ];
    const { container } = mountPanel();
    const thread = container.querySelector(
      '[data-testid="conversation-thread"]',
    );
    expect(thread?.getAttribute("data-conversation-id")).toBe("live");
    expect(thread?.getAttribute("data-model")).toBe("composer-2.5-fast");
    expect(
      container.querySelector('[data-testid="channel-transcript-panel"]'),
    ).toBeTruthy();
  });

  it("names the Implementing channel in the empty state", () => {
    queryState.data = [];
    const { container } = mountPanel("Implementing");
    expect(container.textContent).toContain("No implementing session.");
    expect(container.textContent).toContain(
      "This channel is for implementing work on this issue.",
    );
  });
});

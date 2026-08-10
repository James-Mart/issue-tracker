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

const threadProps = vi.hoisted(() => ({
  hideComposer: false,
}));

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: () => ({
    data: queryState.data,
    isLoading: queryState.isLoading,
    error: queryState.error,
  }),
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
    onLockRefusal,
  }: {
    onStarted: (session: {
      id: string;
      title: string;
      model: string;
    }) => void;
    onLockRefusal: (refusal: {
      holderIssueId: string;
      holderIssueTitle: string;
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
      <button
        type="button"
        data-testid="implementing-trigger-lock"
        onClick={() =>
          onLockRefusal({
            holderIssueId: "ship-it",
            holderIssueTitle: "Ship it",
          })
        }
      >
        Trigger lock
      </button>
    </div>
  ),
  ImplementingLockRefusalState: ({
    refusal,
  }: {
    refusal: { holderIssueId: string; holderIssueTitle: string };
  }) => (
    <div data-testid="implementing-lock-refusal">
      {refusal.holderIssueTitle}
    </div>
  ),
  ImplementingNewRunControl: () => (
    <button type="button" data-testid="implementing-new-run">
      New run
    </button>
  ),
}));

vi.mock("./channel-session-switcher", () => ({
  ChannelSessionSwitcher: ({
    sessions,
    selectedId,
    onSelectedIdChange,
  }: {
    sessions: readonly ChannelSessionListItem[];
    selectedId: string;
    onSelectedIdChange: (id: string) => void;
  }) => (
    <div data-testid="channel-session-switcher">
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          data-testid={`pick-session-${session.id}`}
          aria-pressed={session.id === selectedId}
          onClick={() => onSelectedIdChange(session.id)}
        >
          {session.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/features/agents/components/conversation-thread", () => ({
  ConversationThread: ({
    conversationId,
    meta,
    hideComposer,
  }: {
    conversationId: string;
    meta?: { title: string; model: string };
    hideComposer?: boolean;
  }) => {
    threadProps.hideComposer = hideComposer ?? false;
    return (
      <div
        data-testid="conversation-thread"
        data-conversation-id={conversationId}
        data-model={meta?.model ?? ""}
        data-hide-composer={hideComposer ? "true" : "false"}
      />
    );
  },
}));

function mountPanel(
  label = "Planning",
  issue?: {
    kind: "idea" | "epic";
    id: string;
    title: string;
    partOf: string;
    order: number;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
    status?: "open";
  },
  options?: {
    channel?: "planning" | "implementing";
    projectId?: string;
    parentKind?: "project" | "epic";
  },
): {
  container: HTMLDivElement;
  root: Root;
} {
  const channel = options?.channel ?? "planning";
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChannelTranscriptPanel
        issueId={issue?.id ?? "capture"}
        issue={issue}
        channel={channel}
        label={label}
        projectId={options?.projectId}
        parentKind={options?.parentKind}
      />,
    );
  });
  return { container, root };
}

const idea = {
  kind: "idea" as const,
  id: "capture",
  title: "Capture",
  partOf: "platform",
  order: 0,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const epic = {
  kind: "epic" as const,
  id: "ship-it",
  title: "Ship it",
  partOf: "platform",
  status: "open" as const,
  order: 0,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

afterEach(() => {
  document.body.innerHTML = "";
  queryState.data = undefined;
  queryState.isLoading = false;
  queryState.error = null;
  threadProps.hideComposer = false;
});

describe("ChannelTranscriptPanel", () => {
  it("shows the planning launch empty state for an Idea with no session", () => {
    queryState.data = [];
    const { container } = mountPanel("Planning", idea);
    expect(
      container.querySelector('[data-testid="planning-channel-empty-state"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="conversation-composer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
  });

  it("mounts the transcript after start before the sessions list refetches", () => {
    queryState.data = [];
    const { container } = mountPanel("Planning", idea);
    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-channel-empty-state"] button',
        ) as HTMLButtonElement
      ).click();
    });
    expect(queryState.data).toEqual([]);
    const thread = container.querySelector(
      '[data-testid="conversation-thread"]',
    );
    expect(thread?.getAttribute("data-conversation-id")).toBe("new-session");
    expect(
      container.querySelector('[data-testid="planning-channel-empty-state"]'),
    ).toBeNull();
  });

  it("shows generic ShellState when the channel has no session and no Idea context", () => {
    queryState.data = [];
    const { container } = mountPanel();
    expect(container.textContent).toContain("No planning session.");
    expect(container.textContent).toContain(
      "This channel is for planning work on this issue.",
    );
    expect(
      container.querySelector('[data-testid="planning-channel-empty-state"]'),
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
    const { container } = mountPanel("Planning", idea);
    const thread = container.querySelector(
      '[data-testid="conversation-thread"]',
    );
    expect(thread?.getAttribute("data-conversation-id")).toBe("live");
    expect(thread?.getAttribute("data-model")).toBe("composer-2.5-fast");
    expect(
      container.querySelector('[data-testid="channel-transcript-panel"]'),
    ).toBeTruthy();
  });

  it("does not render the session switcher when the channel has one session", () => {
    queryState.data = [
      {
        id: "only",
        title: "Solo",
        model: "composer-2.5-fast",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archived: false,
        activeRun: false,
      },
    ];
    const { container } = mountPanel("Planning", idea);
    expect(
      container.querySelector('[data-testid="channel-session-switcher"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="planning-new-run"]'),
    ).toBeTruthy();
  });

  it("renders the session switcher when the channel has two sessions", () => {
    queryState.data = [
      {
        id: "archived",
        title: "Old",
        model: "composer-2.5-fast",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        archived: true,
        activeRun: false,
      },
      {
        id: "live",
        title: "Live",
        model: "composer-2.5-fast",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: false,
      },
    ];
    const { container } = mountPanel();
    expect(
      container.querySelector('[data-testid="channel-session-switcher"]'),
    ).toBeTruthy();
  });

  it("hides the composer when an archived session is selected", () => {
    queryState.data = [
      {
        id: "archived",
        title: "Old",
        model: "composer-2.5-fast",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        archived: true,
        activeRun: false,
      },
      {
        id: "live",
        title: "Live",
        model: "composer-2.5-fast",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: false,
      },
    ];
    const { container } = mountPanel();
    expect(threadProps.hideComposer).toBe(false);

    act(() => {
      (
        container.querySelector(
          '[data-testid="pick-session-archived"]',
        ) as HTMLButtonElement
      ).click();
    });

    const thread = container.querySelector(
      '[data-testid="conversation-thread"]',
    );
    expect(thread?.getAttribute("data-conversation-id")).toBe("archived");
    expect(thread?.getAttribute("data-hide-composer")).toBe("true");
  });

  it("shows the implementing launch empty state for an Epic with no session", () => {
    queryState.data = [];
    const { container } = mountPanel("Implementing", epic, {
      channel: "implementing",
      projectId: "platform",
    });
    expect(
      container.querySelector('[data-testid="implementing-channel-empty-state"]'),
    ).toBeTruthy();
  });

  it("surfaces a project lock refusal in place for implementing", () => {
    queryState.data = [];
    const { container } = mountPanel("Implementing", epic, {
      channel: "implementing",
      projectId: "platform",
    });
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-trigger-lock"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelector('[data-testid="implementing-lock-refusal"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("Ship it");
  });

  it("names the Implementing channel in the generic empty state without a work root", () => {
    queryState.data = [];
    const { container } = mountPanel("Implementing");
    expect(container.textContent).toContain("No implementing session.");
    expect(container.textContent).toContain(
      "This channel is for implementing work on this issue.",
    );
  });
});

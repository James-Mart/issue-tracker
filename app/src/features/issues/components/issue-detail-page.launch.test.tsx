// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ApiError } from "@/lib/api/errors";
import type { ChannelSessionListItem, DerivedState, IssueDetail, IssueRecord } from "@server/schemas";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { IssueDetailPage } from "./issue-detail-page";
import { TopBar } from "./top-bar";

const mutate = vi.fn();
const mockState = vi.hoisted(() => ({
  issue: null as IssueDetail | null,
  issues: [] as IssueRecord[],
  derived: {} as Record<string, DerivedState>,
  sessions: [] as ChannelSessionListItem[],
}));
const liveRunConfirm = vi.hoisted(() => ({
  midRun: false,
  pending: null as null | (() => void | Promise<void>),
}));

vi.mock("../api/queries", () => ({
  useIssueDetailQuery: () => ({
    data: mockState.issue,
    isLoading: false,
    error: null,
  }),
  useIssuesQuery: () => ({
    data: { issues: mockState.issues, derived: mockState.derived },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useChannelSessionsQuery: () => ({
    data: mockState.sessions,
    isLoading: false,
    error: null,
  }),
  useCommentsQuery: () => ({ data: { messages: [] }, isLoading: false }),
  useIssueAgentRunsQuery: () => ({ data: { runs: [] }, isLoading: false }),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] },
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: (issueId: string, channel: string) => ({
    mutate: (...args: unknown[]) => {
      mutate(issueId, channel, ...args);
    },
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUploadAttachment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../hooks/use-confirm-channel-live-run", () => ({
  useConfirmChannelLiveRun: () => ({
    confirmIfLiveRun: (action: () => void) => {
      if (!liveRunConfirm.midRun) {
        action();
        return;
      }
      liveRunConfirm.pending = action;
    },
    awaitingConfirm: liveRunConfirm.pending !== null,
    confirming: false,
    dialog: null,
  }),
}));

vi.mock("../hooks/use-issue-detail-file-upload", () => ({
  useIssueDetailFileUpload: () => ({
    rootProps: {},
  }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("./restart-control", () => ({
  RestartControl: () => null,
}));

vi.mock("@/features/agents/components/conversation-thread", () => ({
  ConversationThread: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="conversation-thread" data-conversation-id={conversationId}>
      session thread
    </div>
  ),
  OpenThreadChrome: ({
    title,
    runActive,
  }: {
    title: string;
    runActive: boolean;
  }) => (
    <div data-testid="open-thread-chrome">
      <span>{title}</span>
      <div
        data-testid="thread-status-strip"
        data-run-active={runActive ? "true" : "false"}
      >
        {runActive ? "running" : "idle"} 0 tokens · in 0 · out 0
      </div>
    </div>
  ),
}));

vi.mock("./issue-meta-panel", () => ({
  IssueMetaPanel: () => null,
}));
vi.mock("./attachments-panel", () => ({
  IssueAttachmentsSection: () => null,
}));
vi.mock("./issue-description-field", () => ({
  IssueDescriptionField: () => null,
}));
vi.mock("./comments/comments-section", () => ({
  IssueCommentsSection: () => null,
}));
vi.mock("./epic-story-rail", () => ({
  EpicStoryRail: () => null,
}));
vi.mock("./story-task-rail", () => ({
  StoryTaskRail: () => null,
}));
vi.mock("./delete-partial-plan-control", () => ({
  DeletePartialPlanDetailAction: () => null,
}));
vi.mock("./channel-retro-control", () => ({
  ChannelRetroControl: () => null,
}));

const t0 = "2026-07-01T00:00:00.000Z";

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: `Project ${id}`,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

function epicRecord(id: string, partOf: string, title: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function ideaRecord(id: string, partOf: string, title: string): IssueRecord {
  return {
    id,
    kind: "idea",
    title,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

function epicDetail(id: string, partOf: string, title: string): IssueDetail {
  return {
    ...epicRecord(id, partOf, title),
    description: "",
    labels: [],
  };
}

function ideaDetail(id: string, partOf: string, title: string): IssueDetail {
  return {
    ...ideaRecord(id, partOf, title),
    description: "",
    labels: [],
    stakeholder: "composer-2.5",
  };
}

function mountDetail(entry: string): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <SidebarProvider>
          <TopBar />
          <Routes>
            <Route
              path="/projects/:projectId/issues/:id"
              element={<IssueDetailPage />}
            />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function remount(
  root: Root,
  entry: string,
): void {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <SidebarProvider>
          <TopBar />
          <Routes>
            <Route
              path="/projects/:projectId/issues/:id"
              element={<IssueDetailPage />}
            />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>,
    );
  });
}

function mutateOptions(): {
  onSuccess?: (result: { id: string }) => void;
  onError?: (err: Error) => void;
} {
  return mutate.mock.calls[0]?.[3] as {
    onSuccess?: (result: { id: string }) => void;
    onError?: (err: Error) => void;
  };
}

function selectedTab(container: ParentNode): string | undefined {
  return Array.from(container.querySelectorAll('[role="tab"]'))
    .find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent?.trim();
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  mockState.issue = null;
  mockState.issues = [];
  mockState.derived = {};
  mockState.sessions = [];
  liveRunConfirm.midRun = false;
  liveRunConfirm.pending = null;
  resetCockpitLaunchStore();
});

describe("Issue detail launch — Epic implementing", () => {
  function seedEpic(): void {
    mockState.issue = epicDetail("auth-hardening", "p-a", "Auth hardening");
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
    ];
    mockState.derived = {
      "auth-hardening": { blocked: false, epicStatus: "todo" },
    };
  }

  it("flips top bar, chip, tab live, run strip, and starting body together on click", () => {
    seedEpic();
    const { container } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );

    expect(
      container.querySelectorAll('[data-testid="implementing-start-session"]')
        .length,
    ).toBe(1);

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(container.textContent).toContain("in progress");
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]')
        ?.textContent,
    ).toContain("Implementing");
    expect(
      container.querySelector('[data-testid="thread-status-strip"]')
        ?.textContent,
    ).toContain("running");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("Starting the work loop…");
  });

  it("shows the session thread on session-create ack", () => {
    seedEpic();
    const { container } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onSuccess?.({ id: "sess-1" });
    });

    expect(
      container.querySelector('[data-testid="conversation-thread"]')
        ?.textContent,
    ).toContain("session thread");
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("sess-1");
    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
  });

  it("restores the quiet ready instrument with a named 409 fault", () => {
    seedEpic();
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
      epicRecord("push", "p-a", "Push notifications"),
    ];
    const { container } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(
        new ApiError("conflict", 409, {
          error: "locked",
          holderIssueId: "push",
          holderIssueTitle: "Push notifications",
        }),
      );
    });

    expect(container.querySelector('[data-live="false"]')?.textContent).toContain(
      "all quiet",
    );
    expect(container.textContent).toContain("todo");
    expect(container.textContent).not.toContain("in progress");
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="implementing-start-session"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]')
        ?.textContent,
    ).toContain(
      "Session create rejected — implementing lock held by Push notifications (409).",
    );
  });

  it("selects Implementing immediately when launched from Overview", () => {
    seedEpic();
    const { container } = mountDetail("/projects/p-a/issues/auth-hardening");
    expect(selectedTab(container)).toContain("Overview");

    expect(
      container.querySelectorAll(
        '[data-testid="implementing-overview-start-session"]',
      ).length,
    ).toBe(1);
    expect(
      container.querySelector('[data-testid="implementing-start-session"]'),
    ).toBeNull();

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-overview-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(selectedTab(container)).toContain("Implementing");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("Starting the work loop…");
  });

  it("silently follows a later issues GET that disagrees with the optimistic instrument", () => {
    seedEpic();
    const { container, root } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onSuccess?.({ id: "sess-1" });
    });
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeTruthy();

    mockState.derived = {
      "auth-hardening": { blocked: false, epicStatus: "todo" },
    };
    remount(root, "/projects/p-a/issues/auth-hardening?tab=implementing");

    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
    expect(container.textContent).toContain("todo");
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]'),
    ).toBeNull();
    expect(container.querySelector('[data-live="false"]')?.textContent).toContain(
      "all quiet",
    );
    expect(container.querySelector('[data-testid="channel-launch-fault"]')).toBeNull();
  });

  it("keeps the top bar live on a failed launch when another issue already has a live run", () => {
    seedEpic();
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
      epicRecord("live-epic", "p-a", "Already flying"),
    ];
    mockState.derived = {
      "auth-hardening": { blocked: false, epicStatus: "todo" },
      "live-epic": { blocked: false, epicStatus: "in-progress", liveRun: true },
    };
    const { container } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(new ApiError("failed", 500, { error: "nope" }));
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(
      container.querySelector('[data-testid="implementing-start-session"]'),
    ).toBeTruthy();
  });
});

describe("Issue detail launch — Idea planning", () => {
  function seedIdea(): void {
    mockState.issue = ideaDetail("offline-sync", "p-a", "Offline sync");
    mockState.issues = [
      project("p-a"),
      ideaRecord("offline-sync", "p-a", "Offline sync"),
    ];
    mockState.derived = {
      "offline-sync": { blocked: false, ideaStatus: "captured" },
    };
  }

  it("flips top bar, planning chip, tab live, run strip, and starting body together on click", () => {
    seedIdea();
    const { container } = mountDetail(
      "/projects/p-a/issues/offline-sync?tab=planning",
    );

    expect(
      container.querySelectorAll('[data-testid="planning-start-session"]').length,
    ).toBe(1);

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(container.textContent).toContain("planning");
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]')
        ?.textContent,
    ).toContain("Planning");
    expect(
      container.querySelector('[data-testid="thread-status-strip"]')
        ?.textContent,
    ).toContain("running");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("Starting the planning session…");
  });

  it("shows the session thread on planning ack", () => {
    seedIdea();
    const { container } = mountDetail(
      "/projects/p-a/issues/offline-sync?tab=planning",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onSuccess?.({ id: "plan-1" });
    });

    expect(
      container.querySelector('[data-testid="conversation-thread"]')
        ?.textContent,
    ).toContain("session thread");
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("plan-1");
  });

  it("selects Planning immediately when launched from Overview", () => {
    seedIdea();
    const { container } = mountDetail("/projects/p-a/issues/offline-sync");
    expect(selectedTab(container)).toContain("Overview");

    expect(
      container.querySelectorAll(
        '[data-testid="planning-overview-start-session"]',
      ).length,
    ).toBe(1);
    expect(
      container.querySelector('[data-testid="planning-start-session"]'),
    ).toBeNull();

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-overview-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(selectedTab(container)).toContain("Planning");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("Starting the planning session…");
  });

  it("restores the quiet ready instrument with a named fault", () => {
    seedIdea();
    const { container } = mountDetail(
      "/projects/p-a/issues/offline-sync?tab=planning",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(new ApiError("upstream refused", 500));
    });

    expect(container.querySelector('[data-live="false"]')?.textContent).toContain(
      "all quiet",
    );
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll('[data-testid="planning-start-session"]').length,
    ).toBe(1);
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]')
        ?.textContent,
    ).toContain("Session create rejected — upstream refused.");
  });
});

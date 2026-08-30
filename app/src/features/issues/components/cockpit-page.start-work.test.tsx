// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ApiError } from "@/lib/api/errors";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { CockpitPage } from "./cockpit-page";
import { TopBar } from "./top-bar";

const mutate = vi.fn();
const mockState = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  derived: {} as Record<string, DerivedState>,
}));
const liveRunConfirm = vi.hoisted(() => ({
  midRun: false,
  pending: null as null | (() => void | Promise<void>),
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: { issues: mockState.issues, derived: mockState.derived },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useProjectPullRequestsQuery: () => ({
    data: undefined,
    error: null,
  }),
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

vi.mock("../store/use-issue-ui-store", () => ({
  useIssueUiStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openProjectDialog: vi.fn() }),
}));

vi.mock("./restart-control", () => ({
  RestartControl: () => null,
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

function epic(id: string, partOf: string, title = id): IssueRecord {
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

function idea(id: string, partOf: string, title = id): IssueRecord {
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

function mountCockpit(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarProvider>
          <TopBar />
          <CockpitPage />
        </SidebarProvider>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function section(container: ParentNode, key: string): HTMLElement | null {
  return container.querySelector(`section[aria-labelledby="cockpit-${key}"]`);
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

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  mockState.issues = [];
  mockState.derived = {};
  liveRunConfirm.midRun = false;
  liveRunConfirm.pending = null;
  resetCockpitLaunchStore();
});

describe("CockpitPage start work", () => {
  it("renders a page-level blocked panel when implementing lock is refused", () => {
    mutate.mockImplementation((_issueId, _channel, _body, options) => {
      options?.onError?.(
        new ApiError("conflict", 409, {
          error: "locked",
          holderIssueId: "other-epic",
          holderIssueTitle: "Other epic",
        }),
      );
    });
    mockState.issues = [project("p-a"), epic("ready-epic", "p-a")];
    mockState.derived = {
      "ready-epic": { blocked: false, epicStatus: "todo" },
    };

    const { container } = mountCockpit();

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-work"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.textContent).toContain("Another implementing run is active");
    expect(container.textContent).toContain("Other epic is holding the lock");
    expect(
      container.querySelector('[data-testid="implementing-lock-holder-link"]'),
    ).toBeTruthy();
    expect(container.querySelector('section[aria-labelledby="cockpit-ready"]')).toBeNull();
  });

  it("lights the top bar and shows a row spinner before the session POST resolves", () => {
    mockState.issues = [
      project("p-a"),
      epic("ready-epic", "p-a", "Auth hardening"),
      epic("other-epic", "p-a", "Push notifications"),
    ];
    mockState.derived = {
      "ready-epic": { blocked: false, epicStatus: "todo" },
      "other-epic": { blocked: false, epicStatus: "todo" },
    };

    const { container } = mountCockpit();
    const ready = section(container, "ready");
    const startButtons = ready?.querySelectorAll(
      '[data-testid="flow-row-start-work"]',
    );
    expect(startButtons?.length).toBe(2);

    act(() => {
      (startButtons?.[0] as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(section(container, "ready")?.textContent).toContain("Auth hardening");
    expect(section(container, "inFlight")).toBeNull();
    expect(
      section(container, "ready")?.querySelector(
        '[data-testid="flow-row-launch-pending"]',
      ),
    ).toBeTruthy();
    expect(
      section(container, "ready")?.querySelectorAll(
        '[data-testid="flow-row-start-work"]',
      ).length,
    ).toBe(1);
  });

  it("moves the launching work-root to In flight on session-create ack", () => {
    mockState.issues = [
      project("p-a"),
      epic("ready-epic", "p-a", "Auth hardening"),
      epic("other-epic", "p-a", "Push notifications"),
    ];
    mockState.derived = {
      "ready-epic": { blocked: false, epicStatus: "todo" },
      "other-epic": { blocked: false, epicStatus: "todo" },
    };

    const { container } = mountCockpit();
    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-work"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onSuccess?.({ id: "sess-1" });
    });

    expect(section(container, "inFlight")?.textContent).toContain(
      "Auth hardening",
    );
    expect(section(container, "ready")?.textContent).not.toContain(
      "Auth hardening",
    );
    expect(section(container, "ready")?.textContent).toContain(
      "Push notifications",
    );
    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
  });

  it("rolls a failed work launch back to Ready with a named fault while another row stays startable", () => {
    mockState.issues = [
      project("p-a"),
      epic("ready-epic", "p-a", "Auth hardening"),
      epic("other-epic", "p-a", "Push notifications"),
    ];
    mockState.derived = {
      "ready-epic": { blocked: false, epicStatus: "todo" },
      "other-epic": { blocked: false, epicStatus: "todo" },
    };

    const { container } = mountCockpit();
    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-work"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(new ApiError("failed", 500, { error: "nope" }));
    });

    expect(section(container, "inFlight")).toBeNull();
    expect(section(container, "ready")?.textContent).toContain("Auth hardening");
    expect(
      container.querySelector('[data-testid="flow-row-launch-fault"]')
        ?.textContent,
    ).toBe("Auth hardening — Work loop didn't start. Start work again.");
    expect(container.querySelector('[data-live="true"]')).toBeNull();
    expect(container.querySelector('[data-live="false"]')?.textContent).toContain(
      "all quiet",
    );
    expect(
      section(container, "ready")?.querySelectorAll(
        '[data-testid="flow-row-start-work"]',
      ).length,
    ).toBe(2);
  });

  it("keeps the top bar live on a failed launch when another issue already has a live run", () => {
    mockState.issues = [
      project("p-a"),
      epic("ready-epic", "p-a", "Auth hardening"),
      epic("live-epic", "p-a", "Already flying"),
    ];
    mockState.derived = {
      "ready-epic": { blocked: false, epicStatus: "todo" },
      "live-epic": { blocked: false, epicStatus: "in-progress", liveRun: true },
    };

    const { container } = mountCockpit();
    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-work"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(new ApiError("failed", 500, { error: "nope" }));
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(section(container, "ready")?.textContent).toContain("Auth hardening");
  });

  it("silently follows a later issues GET that disagrees with optimistic placement", () => {
    mockState.issues = [
      project("p-a"),
      epic("ready-epic", "p-a", "Auth hardening"),
    ];
    mockState.derived = {
      "ready-epic": { blocked: false, epicStatus: "todo" },
    };

    const { container, root } = mountCockpit();
    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-work"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onSuccess?.({ id: "sess-1" });
    });
    expect(section(container, "inFlight")?.textContent).toContain(
      "Auth hardening",
    );

    mockState.derived = {
      "ready-epic": { blocked: false, epicStatus: "todo" },
    };
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <SidebarProvider>
            <TopBar />
            <CockpitPage />
          </SidebarProvider>
        </MemoryRouter>,
      );
    });

    expect(section(container, "inFlight")).toBeNull();
    expect(section(container, "ready")?.textContent).toContain("Auth hardening");
    expect(container.querySelector('[data-testid="flow-row-launch-fault"]')).toBeNull();
    expect(container.querySelector('[data-live="false"]')?.textContent).toContain(
      "all quiet",
    );
  });
});

describe("CockpitPage start planning", () => {
  it("shows a pending spinner then moves the Idea to In flight on ack", () => {
    mockState.issues = [
      project("p-a"),
      idea("offline", "p-a", "Offline sync"),
    ];
    mockState.derived = {
      offline: { blocked: false, ideaStatus: "captured" },
    };

    const { container } = mountCockpit();
    expect(section(container, "awaitingPlanning")?.textContent).toContain(
      "Offline sync",
    );

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-planning"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(section(container, "awaitingPlanning")?.textContent).toContain(
      "Offline sync",
    );
    expect(section(container, "inFlight")).toBeNull();
    expect(
      section(container, "awaitingPlanning")?.querySelector(
        '[data-testid="flow-row-launch-pending"]',
      ),
    ).toBeTruthy();

    act(() => {
      mutateOptions().onSuccess?.({ id: "plan-1" });
    });

    expect(section(container, "inFlight")?.textContent).toContain("Offline sync");
    expect(section(container, "awaitingPlanning")).toBeNull();
    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
  });
});

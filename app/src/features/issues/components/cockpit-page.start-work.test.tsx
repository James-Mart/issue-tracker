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
  hookOnError: undefined as ((err: Error) => void) | undefined,
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
  useCreateChannelSession: (
    issueId: string,
    channel: string,
    options?: { onError?: (err: Error) => void },
  ) => ({
    mutate: (...args: unknown[]) => {
      mockState.hookOnError = options?.onError;
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
    confirmIfLiveRun: (action: () => void) => action(),
    awaitingConfirm: false,
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

vi.mock("./backup-chip", () => ({
  BackupChip: () => null,
}));

const t0 = "2026-07-01T00:00:00.000Z";

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: `Project ${id}`,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
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
  const passed = mutate.mock.calls[0]?.[3] as
    | { onSuccess?: (result: { id: string }) => void }
    | undefined;
  return { onSuccess: passed?.onSuccess, onError: mockState.hookOnError };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  mockState.issues = [];
  mockState.derived = {};
  mockState.hookOnError = undefined;
  resetCockpitLaunchStore();
});

describe("CockpitPage start work", () => {
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

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { CockpitPage } from "./cockpit-page";

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

function epic(id: string, partOf: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
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
        <CockpitPage />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  mockState.issues = [];
  mockState.derived = {};
  liveRunConfirm.midRun = false;
  liveRunConfirm.pending = null;
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
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import type { PrFacts, ProjectPrsResponse } from "@server/services/delivery";
import {
  PrStatusPanel,
  UNKNOWN_MERGEABLE_REFETCH_MS,
} from "./pr-status-panel";

const queryState = vi.hoisted(() => ({
  data: undefined as ProjectPrsResponse | undefined,
}));

const refreshLive = vi.hoisted(() =>
  vi.fn(async (_qc: unknown, _projectId: string) => {}),
);

const mergeMutate = vi.hoisted(() => vi.fn());

vi.mock("../api/pr-sync-live", () => ({
  refreshProjectPullRequestsLive: (qc: unknown, projectId: string) =>
    refreshLive(qc, projectId),
}));

vi.mock("../api/queries", () => ({
  useProjectPullRequestsQuery: () => ({
    data: queryState.data,
    error: null,
    isLoading: false,
    isFetching: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useMergeStory: () => ({
    mutate: mergeMutate,
    isPending: false,
  }),
}));

const story: Extract<IssueDetail, { kind: "story" }> & { prUrl: string } = {
  kind: "story",
  id: "ship-pr",
  title: "Ship PR",
  partOf: "epic",
  order: 0,
  archived: false,
  needsAttention: false,
  attentionReason: null,
  merged: false,
  reviewedTasks: [],
  prUrl: "https://github.com/acme/widgets/pull/12",
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  description: "",
  version: "1",
};

function prFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    number: 12,
    url: "https://github.com/acme/widgets/pull/12",
    state: "open",
    isDraft: false,
    mergeable: "mergeable",
    mergeStateStatus: "CLEAN",
    reviewDecision: "approved",
    checks: { state: "success", failing: 0, pending: 0, total: 3 },
    commentCount: 0,
    comments: [],
    headRefOid: "abc123",
    baseRefName: "main",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function mountPanel(): {
  container: HTMLDivElement;
  root: Root;
  client: QueryClient;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PrStatusPanel story={story} projectId="platform" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { container, root, client };
}

function unmount(mounted: {
  root: Root;
  container: HTMLDivElement;
  client: QueryClient;
}): void {
  act(() => {
    mounted.root.unmount();
  });
  mounted.client.clear();
  mounted.container.remove();
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  queryState.data = undefined;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PrStatusPanel merge control", () => {
  it("names the head commit in the dialog and sends it on submit", () => {
    queryState.data = {
      prs: { "ship-pr": prFacts({ headRefOid: "abc123def456" }) },
    };
    const mounted = mountPanel();
    act(() => {
      (
        mounted.container.querySelector(
          '[data-testid="pr-merge-open"]',
        ) as HTMLButtonElement
      ).click();
    });
    const dialog = document.body.querySelector(
      '[data-testid="merge-pr-dialog"]',
    );
    expect(dialog?.textContent).toContain("abc123def456");
    act(() => {
      (
        document.body.querySelector(
          '[data-testid="merge-pr-confirm"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(mergeMutate).toHaveBeenCalledWith(
      {
        id: "ship-pr",
        auto: undefined,
        matchHeadCommit: "abc123def456",
      },
      expect.any(Object),
    );
    unmount(mounted);
  });

  it("refetches while mergeability is unknown and does not offer Merge", () => {
    vi.useFakeTimers();
    queryState.data = {
      prs: {
        "ship-pr": prFacts({
          mergeable: "unknown",
          mergeStateStatus: "UNKNOWN",
        }),
      },
    };
    const mounted = mountPanel();
    expect(mounted.container.textContent).toContain("Unknown");
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-open"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="pr-auto-merge-open"]'),
    ).toBeNull();
    expect(mounted.container.textContent).not.toContain("Open on GitHub");
    expect(mounted.container.textContent).not.toContain(
      "Mergeability is still unknown",
    );
    expect(refreshLive).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(UNKNOWN_MERGEABLE_REFETCH_MS);
    });
    expect(refreshLive).toHaveBeenCalledWith(mounted.client, "platform");
    const calls = refreshLive.mock.calls.length;
    unmount(mounted);
    act(() => {
      vi.advanceTimersByTime(UNKNOWN_MERGEABLE_REFETCH_MS * 2);
    });
    expect(refreshLive.mock.calls.length).toBe(calls);
  });
});

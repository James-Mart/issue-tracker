// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { PrFacts, ProjectPrsResponse } from "@server/services/delivery";
import { issuesKeys } from "../api/keys";
import { PrStatusPanel } from "./pr-status-panel";

const queryState = vi.hoisted(() => ({
  data: undefined as ProjectPrsResponse | undefined,
  error: null as Error | null,
  isLoading: false,
  isFetching: false,
}));

vi.mock("../api/queries", () => ({
  useProjectPullRequestsQuery: () => ({
    data: queryState.data,
    error: queryState.error,
    isLoading: queryState.isLoading,
    isFetching: queryState.isFetching,
  }),
}));

const story = {
  kind: "story" as const,
  id: "ship-pr",
  title: "Ship PR",
  partOf: "epic",
  order: 0,
  archived: false,
  merged: false,
  prUrl: "https://github.com/acme/widgets/pull/12",
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
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
  invalidateSpy: ReturnType<typeof vi.spyOn>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PrStatusPanel story={story} projectId="platform" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { container, root, client, invalidateSpy };
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
  queryState.error = null;
  queryState.isLoading = false;
  queryState.isFetching = false;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("PrStatusPanel", () => {
  it("renders a draft pull request", () => {
    queryState.data = {
      prs: {
        "ship-pr": prFacts({
          isDraft: true,
          mergeStateStatus: "DRAFT",
          reviewDecision: null,
        }),
      },
    };
    const mounted = mountPanel();
    const panel = mounted.container.querySelector(
      '[data-testid="pr-status-panel"]',
    );
    expect(panel?.getAttribute("data-state")).toBe("draft");
    expect(mounted.container.textContent).toContain("Draft");
    expect(mounted.container.textContent).toContain("Mergeable");
    expect(mounted.container.textContent).toContain("#12");
    unmount(mounted);
  });

  it("renders a ready-and-clean pull request", () => {
    queryState.data = { prs: { "ship-pr": prFacts() } };
    const mounted = mountPanel();
    const panel = mounted.container.querySelector(
      '[data-testid="pr-status-panel"]',
    );
    expect(panel?.getAttribute("data-state")).toBe("ready");
    expect(mounted.container.textContent).toContain("Ready for review");
    expect(mounted.container.textContent).toContain("Mergeable");
    expect(mounted.container.textContent).toContain("Success · 3");
    expect(mounted.container.textContent).toContain("Approved");
    expect(
      mounted.container.querySelector(
        'a[href="https://github.com/acme/widgets/pull/12"]',
      ),
    ).toBeTruthy();
    unmount(mounted);
  });

  it("renders a blocked pull request", () => {
    queryState.data = {
      prs: {
        "ship-pr": prFacts({
          mergeable: "conflicting",
          mergeStateStatus: "BLOCKED",
          reviewDecision: "changes-requested",
          checks: { state: "failure", failing: 2, pending: 0, total: 4 },
        }),
      },
    };
    const mounted = mountPanel();
    const panel = mounted.container.querySelector(
      '[data-testid="pr-status-panel"]',
    );
    expect(panel?.getAttribute("data-state")).toBe("blocked");
    expect(mounted.container.textContent).toContain("Conflicting");
    expect(mounted.container.textContent).toContain("BLOCKED");
    expect(mounted.container.textContent).toContain("Failure · 2 failing");
    expect(mounted.container.textContent).toContain("Changes requested");
    unmount(mounted);
  });

  it("renders not-found when the recorded prUrl no longer resolves", () => {
    queryState.data = {
      prs: { "ship-pr": { reason: "not-found" } },
    };
    const mounted = mountPanel();
    const panel = mounted.container.querySelector(
      '[data-testid="pr-status-panel"]',
    );
    expect(panel?.getAttribute("data-state")).toBe("not-found");
    expect(mounted.container.textContent).toContain(
      "no longer resolves on GitHub",
    );
    expect(
      mounted.container.querySelector(
        'a[href="https://github.com/acme/widgets/pull/12"]',
      ),
    ).toBeTruthy();
    unmount(mounted);
  });

  it("renders an actionable unauthenticated error", () => {
    queryState.error = new ApiError(
      "To use GitHub CLI in non-interactive mode, set the GH_TOKEN environment variable.",
      401,
      {
        error:
          "To use GitHub CLI in non-interactive mode, set the GH_TOKEN environment variable.",
        code: "gh-unauthenticated",
      },
    );
    const mounted = mountPanel();
    const panel = mounted.container.querySelector(
      '[data-testid="pr-status-panel"]',
    );
    expect(panel?.getAttribute("data-state")).toBe("error");
    expect(panel?.getAttribute("data-error-code")).toBe("gh-unauthenticated");
    expect(mounted.container.textContent).toContain("GH_TOKEN");
    expect(mounted.container.textContent).toContain("gh auth login");
    unmount(mounted);
  });

  it("renders distinct copy for each gh error code", () => {
    const cases: Array<{ code: string; needle: string }> = [
      { code: "gh-missing", needle: "Install the GitHub CLI" },
      { code: "gh-failed", needle: "gh works in the project workspace" },
      {
        code: "not-github-pr-url",
        needle: "github.com/…/pull/N",
      },
    ];
    for (const { code, needle } of cases) {
      queryState.error = new ApiError(code, 502, {
        error: code,
        code,
      });
      const mounted = mountPanel();
      const panel = mounted.container.querySelector(
        '[data-testid="pr-status-panel"]',
      );
      expect(panel?.getAttribute("data-error-code")).toBe(code);
      expect(mounted.container.textContent).toContain(needle);
      unmount(mounted);
      queryState.error = null;
    }
  });

  it("invalidates the project PR query when refresh is clicked", () => {
    queryState.data = { prs: { "ship-pr": prFacts() } };
    const mounted = mountPanel();
    const button = mounted.container.querySelector(
      '[data-testid="pr-status-refresh"]',
    );
    expect(button).toBeTruthy();
    act(() => {
      (button as HTMLButtonElement).click();
    });
    expect(mounted.invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.projectPullRequests("platform"),
    });
    unmount(mounted);
  });
});

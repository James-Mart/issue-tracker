// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { PrFacts, ProjectPrsResponse } from "@server/services/delivery";
import { issuesKeys } from "../api/keys";
import {
  PrStatusPanel,
  recentPrComments,
  UNKNOWN_MERGEABLE_REFETCH_MS,
} from "./pr-status-panel";

const queryState = vi.hoisted(() => ({
  data: undefined as ProjectPrsResponse | undefined,
  error: null as Error | null,
  isLoading: false,
  isFetching: false,
}));

const mergeMutate = vi.hoisted(() =>
  vi.fn(
    (
      _vars: unknown,
      opts?: { onSuccess?: () => void },
    ) => {
      opts?.onSuccess?.();
    },
  ),
);

vi.mock("../api/queries", () => ({
  useProjectPullRequestsQuery: () => ({
    data: queryState.data,
    error: queryState.error,
    isLoading: queryState.isLoading,
    isFetching: queryState.isFetching,
  }),
}));

vi.mock("../api/mutations", () => ({
  useMergeStory: () => ({
    mutate: mergeMutate,
    isPending: false,
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

function prComment(
  overrides: Partial<PrFacts["comments"][number]> & { url: string },
): PrFacts["comments"][number] {
  return {
    author: "ada",
    body: "Looks good.",
    createdAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

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
  mergeMutate.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
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
    const hostLink = mounted.container.querySelector(
      '[data-testid="pr-number-link"]',
    );
    expect(hostLink?.textContent).toBe("#12");
    expect(hostLink?.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/pull/12",
    );
    expect(
      mounted.container.querySelectorAll(
        'a[href="https://github.com/acme/widgets/pull/12"]',
      ),
    ).toHaveLength(1);
    expect(mounted.container.textContent).not.toContain("Open on GitHub");
    expect(mounted.container.textContent).not.toMatch(/\bLink\b/);
    const merge = mounted.container.querySelector(
      '[data-testid="pr-merge-open"]',
    );
    expect(merge?.textContent).toBe("Merge");
    expect(merge?.parentElement?.className).toMatch(/flex-wrap/);
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
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="pr-number-link"]'),
    ).toBeNull();
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

  it("offers no merge or un-draft control for a draft PR and shows the reason only", () => {
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
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-open"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="pr-auto-merge-open"]'),
    ).toBeNull();
    expect(mounted.container.textContent).toContain(
      "draft and must be marked ready on GitHub",
    );
    expect(mounted.container.textContent).not.toMatch(/mark ready|un-?draft/i);
    expect(mounted.container.textContent).not.toContain("Open on GitHub");
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-github-link"]'),
    ).toBeNull();
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-unavailable"]')
        ?.parentElement?.className,
    ).toMatch(/flex-wrap/);
    expect(
      mounted.container
        .querySelector('[data-testid="pr-number-link"]')
        ?.getAttribute("href"),
    ).toBe("https://github.com/acme/widgets/pull/12");
    unmount(mounted);
  });

  it("offers no merge for a review-required PR and shows the reason", () => {
    queryState.data = {
      prs: {
        "ship-pr": prFacts({
          reviewDecision: "review-required",
          mergeStateStatus: "BLOCKED",
        }),
      },
    };
    const mounted = mountPanel();
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-open"]'),
    ).toBeNull();
    expect(mounted.container.textContent).toContain("Review is required");
    expect(mounted.container.textContent).not.toContain("Open on GitHub");
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-github-link"]'),
    ).toBeNull();
    unmount(mounted);
  });

  it("offers no merge for a conflicting PR and shows the reason", () => {
    queryState.data = {
      prs: {
        "ship-pr": prFacts({
          mergeable: "conflicting",
          mergeStateStatus: "DIRTY",
        }),
      },
    };
    const mounted = mountPanel();
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-open"]'),
    ).toBeNull();
    expect(mounted.container.textContent).toContain("merge conflicts");
    expect(mounted.container.textContent).not.toContain("Open on GitHub");
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-github-link"]'),
    ).toBeNull();
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
    expect(mounted.invalidateSpy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(UNKNOWN_MERGEABLE_REFETCH_MS);
    });
    expect(mounted.invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.projectPullRequests("platform"),
    });
    const calls = mounted.invalidateSpy.mock.calls.length;
    unmount(mounted);
    act(() => {
      vi.advanceTimersByTime(UNKNOWN_MERGEABLE_REFETCH_MS * 2);
    });
    expect(mounted.invalidateSpy.mock.calls.length).toBe(calls);
  });

  it("does not poll when mergeability is known", () => {
    vi.useFakeTimers();
    queryState.data = { prs: { "ship-pr": prFacts() } };
    const mounted = mountPanel();
    act(() => {
      vi.advanceTimersByTime(UNKNOWN_MERGEABLE_REFETCH_MS * 3);
    });
    expect(mounted.invalidateSpy).not.toHaveBeenCalled();
    unmount(mounted);
  });

  it("offers auto-merge when pending checks are the only obstacle", () => {
    queryState.data = {
      prs: {
        "ship-pr": prFacts({
          headRefOid: "pendinghead01",
          mergeStateStatus: "BLOCKED",
          checks: { state: "pending", failing: 0, pending: 2, total: 3 },
        }),
      },
    };
    const mounted = mountPanel();
    expect(
      mounted.container.querySelector('[data-testid="pr-merge-open"]'),
    ).toBeNull();
    const open = mounted.container.querySelector(
      '[data-testid="pr-auto-merge-open"]',
    );
    expect(open?.textContent).toContain("Enable auto-merge");
    act(() => {
      (open as HTMLButtonElement).click();
    });
    expect(
      document.body.querySelector('[data-testid="merge-pr-dialog"]')
        ?.textContent,
    ).toContain("pendinghead01");
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
        auto: true,
        matchHeadCommit: "pendinghead01",
      },
      expect.any(Object),
    );
    unmount(mounted);
  });
});

describe("PrStatusPanel conversation comments", () => {
  it("renders a defined empty state when there are zero comments", () => {
    queryState.data = { prs: { "ship-pr": prFacts({ commentCount: 0 }) } };
    const mounted = mountPanel();
    expect(
      mounted.container.querySelector('[data-testid="pr-comments-section"]'),
    ).toBeTruthy();
    expect(
      mounted.container.querySelector('[data-testid="pr-comments-empty"]'),
    ).toBeTruthy();
    expect(mounted.container.textContent).toContain("No conversation comments.");
    expect(
      mounted.container.querySelector(
        '[data-testid="pr-comments-conversation-link"]',
      ),
    ).toBeNull();
    unmount(mounted);
  });

  it("renders up to three recent comments without a conversation link", () => {
    queryState.data = {
      prs: {
        "ship-pr": prFacts({
          commentCount: 2,
          comments: [
            prComment({
              url: "https://github.com/acme/widgets/pull/12#issuecomment-1",
              author: "ada",
              body: "First comment",
            }),
            prComment({
              url: "https://github.com/acme/widgets/pull/12#issuecomment-2",
              author: "bob",
              body: "Second comment",
            }),
          ],
        }),
      },
    };
    const mounted = mountPanel();
    expect(mounted.container.textContent).toContain("ada");
    expect(mounted.container.textContent).toContain("bob");
    expect(
      mounted.container.querySelector(
        'a[href="https://github.com/acme/widgets/pull/12#issuecomment-1"]',
      ),
    ).toBeTruthy();
    expect(
      mounted.container.querySelector(
        'a[href="https://github.com/acme/widgets/pull/12#issuecomment-2"]',
      ),
    ).toBeTruthy();
    expect(
      mounted.container.querySelector(
        '[data-testid="pr-comments-conversation-link"]',
      ),
    ).toBeNull();
    unmount(mounted);
  });

  it("shows only the three newest comments and links to the conversation", () => {
    queryState.data = {
      prs: {
        "ship-pr": prFacts({
          commentCount: 5,
          comments: [
            prComment({
              url: "https://github.com/acme/widgets/pull/12#issuecomment-1",
              author: "one",
              body: "oldest",
            }),
            prComment({
              url: "https://github.com/acme/widgets/pull/12#issuecomment-2",
              author: "two",
              body: "older",
            }),
            prComment({
              url: "https://github.com/acme/widgets/pull/12#issuecomment-3",
              author: "three",
              body: "third newest",
            }),
            prComment({
              url: "https://github.com/acme/widgets/pull/12#issuecomment-4",
              author: "four",
              body: "second newest",
            }),
            prComment({
              url: "https://github.com/acme/widgets/pull/12#issuecomment-5",
              author: "five",
              body: "newest",
            }),
          ],
        }),
      },
    };
    const mounted = mountPanel();
    const entries = mounted.container.querySelectorAll(
      '[data-testid="pr-comment-entry"]',
    );
    expect(entries).toHaveLength(3);
    expect(mounted.container.textContent).toContain("five");
    expect(mounted.container.textContent).toContain("four");
    expect(mounted.container.textContent).toContain("three");
    expect(mounted.container.textContent).not.toContain("one");
    expect(mounted.container.textContent).not.toContain("two");
    expect(
      mounted.container.querySelector(
        'a[href="https://github.com/acme/widgets/pull/12#issuecomment-5"]',
      ),
    ).toBeTruthy();
    expect(
      mounted.container.querySelector(
        '[data-testid="pr-comments-conversation-link"]',
      ),
    ).toBeTruthy();
    unmount(mounted);
  });
});

describe("recentPrComments", () => {
  it("returns the three newest entries in reverse chronological order", () => {
    const comments = [
      prComment({ url: "https://example.com/1", author: "a" }),
      prComment({ url: "https://example.com/2", author: "b" }),
      prComment({ url: "https://example.com/3", author: "c" }),
      prComment({ url: "https://example.com/4", author: "d" }),
    ];
    expect(recentPrComments(comments).map((c) => c.author)).toEqual([
      "d",
      "c",
      "b",
    ]);
  });
});

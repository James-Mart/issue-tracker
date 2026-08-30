// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentRun } from "../run-list";
import { PipelineRunsView } from "./pipeline-run-list";

vi.mock("@/lib/ws/transport", () => ({
  subscribeTopic: () => () => {},
}));

function recentRun(
  conversationId: string,
  condition: RecentRun["condition"],
): RecentRun {
  return {
    conversationId,
    coordinatorLabel: conversationId,
    startedAt: "2026-08-28T15:00:00.000Z",
    condition,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

type RunsPage = { runs: RecentRun[]; nextCursor: string | null };

function stubPaginatedRuns(pages: RunsPage[], delayMs = 0) {
  let fetchCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: RequestInfo) => {
      const url = new URL(String(input), "http://localhost");
      if (!url.pathname.startsWith("/api/pipeline/runs")) {
        return Promise.resolve(jsonResponse({ error: `unhandled ${url}` }, 404));
      }
      const cursor = url.searchParams.get("cursor");
      const pageIndex =
        cursor == null
          ? 0
          : pages.findIndex(
              (_, index) =>
                index > 0 && pages[index - 1]?.nextCursor === cursor,
            );
      const page = pages[pageIndex >= 0 ? pageIndex : 0] ?? pages[0];
      fetchCount += 1;
      const response = Promise.resolve(jsonResponse(page));
      if (delayMs <= 0) return response;
      return new Promise((resolve) => {
        setTimeout(() => resolve(response), delayMs);
      });
    }),
  );
  return { getFetchCount: () => fetchCount };
}

function stubRuns(runs: RecentRun[]) {
  stubPaginatedRuns([{ runs, nextCursor: null }]);
}

type MockObserverEntry = { isIntersecting: boolean; target: Element };

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private callback: IntersectionObserverCallback;
  target: Element | null = null;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe = vi.fn((target: Element) => {
    this.target = target;
    queueMicrotask(() => {
      this.trigger(true);
    });
  });

  disconnect = vi.fn();
  unobserve = vi.fn();

  trigger(isIntersecting: boolean) {
    if (!this.target) return;
    const entry = {
      isIntersecting,
      target: this.target,
    } as MockObserverEntry;
    this.callback([entry as IntersectionObserverEntry], this);
  }
}

function latestObserver(): MockIntersectionObserver {
  const observer =
    MockIntersectionObserver.instances[
      MockIntersectionObserver.instances.length - 1
    ];
  if (!observer) {
    throw new Error("No IntersectionObserver instance");
  }
  return observer;
}

function mockViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

function runCards(container: ParentNode): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[data-testid="pipeline-run-card"]'),
  ) as HTMLElement[];
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function mountRunsView(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = testQueryClient();
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PipelineRunsView />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { container, root };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushObservers(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await flush();
  });
}

function conditionBadge(
  container: ParentNode,
  conversationId: string,
): HTMLElement {
  const card = container.querySelector(
    `[data-testid="pipeline-run-card"][data-conversation-id="${conversationId}"]`,
  );
  if (!(card instanceof HTMLElement)) {
    throw new Error(`Missing run card: ${conversationId}`);
  }
  const badge = card.querySelector("[data-condition]");
  if (!(badge instanceof HTMLElement)) {
    throw new Error(`Missing condition badge on: ${conversationId}`);
  }
  return badge;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler((cb) => {
    cb();
  });
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  document.body.innerHTML = "";
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PipelineRunsView", () => {
  it("renders one card per fetched run with no elision at desktop width", async () => {
    stubRuns([
      recentRun("a", "completed"),
      recentRun("b", "completed"),
      recentRun("c", "failed"),
    ]);
    const { container } = mountRunsView();
    await flush();

    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["a", "b", "c"]);
    expect(
      container.querySelector('[data-testid="pipeline-run-elision"]'),
    ).toBeNull();
  });

  it("renders one card per fetched run with no elision at phone width", async () => {
    mockViewport(390);
    stubRuns([
      recentRun("a", "completed"),
      recentRun("b", "completed"),
      recentRun("c", "failed"),
      recentRun("d", "completed"),
      recentRun("e", "completed"),
    ]);
    const { container } = mountRunsView();
    await flush();

    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["a", "b", "c", "d", "e"]);
    expect(
      container.querySelector('[data-testid="pipeline-run-elision"]'),
    ).toBeNull();
  });

  it("renders a spinner on the live condition badge only", async () => {
    stubRuns([
      recentRun("live-run", "in-flight"),
      recentRun("done-run", "completed"),
    ]);
    const { container } = mountRunsView();
    await flush();

    const liveBadge = conditionBadge(container, "live-run");
    expect(liveBadge.getAttribute("data-condition")).toBe("in-flight");
    expect(liveBadge.textContent).toBe("live");
    expect(liveBadge.querySelector('[class*="animate-spin"]')).not.toBeNull();

    const doneBadge = conditionBadge(container, "done-run");
    expect(doneBadge.getAttribute("data-condition")).toBe("completed");
    expect(doneBadge.textContent).toBe("done");
    expect(doneBadge.querySelector('[class*="animate-spin"]')).toBeNull();
  });

  it("calls fetchNextPage when the sentinel intersects", async () => {
    let resolveSecondPage: (value: unknown) => void = () => {};
    const secondPageGate = new Promise((resolve) => {
      resolveSecondPage = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = new URL(String(input), "http://localhost");
        if (!url.pathname.startsWith("/api/pipeline/runs")) {
          return Promise.resolve(jsonResponse({ error: `unhandled ${url}` }, 404));
        }
        const cursor = url.searchParams.get("cursor");
        if (cursor == null) {
          return Promise.resolve(
            jsonResponse({
              runs: [recentRun("page-0", "completed")],
              nextCursor: "cursor-1",
            }),
          );
        }
        return secondPageGate.then(() =>
          jsonResponse({
            runs: [recentRun("page-1", "completed")],
            nextCursor: null,
          }),
        );
      }),
    );

    const { container } = mountRunsView();
    await flushObservers();

    expect(
      container.querySelector('[data-testid="pipeline-run-list-loading-foot"]'),
    ).not.toBeNull();

    await act(async () => {
      resolveSecondPage(undefined);
      await flush();
    });

    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["page-0", "page-1"]);
    expect(
      container.querySelector('[data-testid="pipeline-run-list-sentinel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="pipeline-run-list-loading-foot"]'),
    ).toBeNull();
  });

  it("does not fetch again while the next page is in flight", async () => {
    let resolveSecondPage: (value: unknown) => void = () => {};
    const secondPageGate = new Promise((resolve) => {
      resolveSecondPage = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = new URL(String(input), "http://localhost");
        if (!url.pathname.startsWith("/api/pipeline/runs")) {
          return Promise.resolve(jsonResponse({ error: `unhandled ${url}` }, 404));
        }
        const cursor = url.searchParams.get("cursor");
        if (cursor == null) {
          return Promise.resolve(
            jsonResponse({
              runs: [recentRun("page-0", "completed")],
              nextCursor: "cursor-1",
            }),
          );
        }
        return secondPageGate.then(() =>
          jsonResponse({
            runs: [recentRun("page-1", "completed")],
            nextCursor: null,
          }),
        );
      }),
    );

    const { container } = mountRunsView();
    await flushObservers();

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      latestObserver().trigger(true);
      await flush();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecondPage(undefined);
      await flush();
    });
  });

  it("pages forward when the sentinel is already visible", async () => {
    stubPaginatedRuns([
      {
        runs: [recentRun("page-0", "completed")],
        nextCursor: "cursor-1",
      },
      {
        runs: [recentRun("page-1", "completed")],
        nextCursor: "cursor-2",
      },
      {
        runs: [recentRun("page-2", "completed")],
        nextCursor: null,
      },
    ]);
    const { container } = mountRunsView();
    await flushObservers();

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
    expect(
      runCards(container).map((el) => el.getAttribute("data-conversation-id")),
    ).toEqual(["page-0", "page-1", "page-2"]);
  });

  it("renders neither sentinel nor loading foot when hasNextPage is false", async () => {
    stubRuns([recentRun("only-run", "completed")]);
    const { container } = mountRunsView();
    await flush();

    expect(
      container.querySelector('[data-testid="pipeline-run-list-sentinel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="pipeline-run-list-loading-foot"]'),
    ).toBeNull();
  });
});

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

function stubRuns(runs: RecentRun[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith("/api/pipeline/runs")) {
        return Promise.resolve(jsonResponse({ runs }));
      }
      return Promise.resolve(jsonResponse({ error: `unhandled ${url}` }, 404));
    }),
  );
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
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/errors";
import { toast } from "sonner";
import type { HealthResponse } from "../api/queries";
import { restartLiveTurnsMessage } from "../lib/restart-refusal";
import { RestartControl } from "./restart-control";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

const health: HealthResponse = {
  bootId: "boot-1",
  startedAt: "2026-08-20T00:00:00.000Z",
  restartSupported: true,
  guest: false,
};

function mountControl(): {
  container: HTMLDivElement;
  root: Root;
  client: QueryClient;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={0}>
          <RestartControl />
        </TooltipProvider>
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  });
}

function button(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    '[data-testid="restart-control"]',
  ) as HTMLButtonElement;
}

function status(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="restart-control-status"]');
}

function postCalls(): unknown[][] {
  return requestMock.mock.calls.filter(([path]) => path === "/api/restart");
}

function liveTurnsDialog(): HTMLElement | null {
  return document.body.querySelector(
    '[data-testid="restart-live-turns-dialog"]',
  );
}

function runsInFlightError(count: number): ApiError {
  return new ApiError("Request failed with status 409", 409, {
    code: "runs-in-flight",
    activeRuns: Array.from({ length: count }, (_, i) => ({
      conversationId: `conv-${i + 1}`,
    })),
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  requestMock.mockImplementation(async (path: string) => {
    if (path === "/api/health") return health;
    if (path === "/api/restart") throw runsInFlightError(2);
    throw new Error(`unexpected ${String(path)}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("RestartControl", () => {
  it("opens a confirmation dialog when restart is refused for live turns", async () => {
    const mounted = mountControl();
    await flush();

    act(() => {
      button(mounted.container).click();
    });
    await flush();

    expect(postCalls()).toHaveLength(1);
    expect(postCalls()[0]![1]).toEqual({ method: "POST" });
    expect(liveTurnsDialog()?.textContent).toContain(
      restartLiveTurnsMessage(2),
    );
    expect(status(mounted.container)).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();

    unmount(mounted);
  });
});
